import { createHash, createHmac, randomBytes } from 'node:crypto'

import {
  AnalyticsBatchRequestSchema,
  ClientErrorBatchRequestSchema,
  FavoriteSyncRecordSchema,
  FeedbackRequestSchema,
  GuestAuthRequestSchema,
  LearningActivitySyncRecordSchema,
  ReviewSyncRecordSchema,
  SyncRequestSchema,
  TrainingCompletionSchema,
  TrainingProgressSyncRecordSchema,
  WechatAuthRequestSchema,
  type SyncSnapshot,
  type TrainingCompletion,
} from '@microly/api-contract'
import { TrainingContentBundleSchema, type TrainingContentBundle } from '@microly/content-schema'
import { and, desc, eq, gt } from 'drizzle-orm'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

import { registerAdminRoutes } from './admin.js'
import { createDeepseekProvider, registerAiRoutes, type AiProvider } from './ai.js'
import { RuntimeMetrics } from './runtime-metrics.js'
import { RuntimeAlertMonitor } from './runtime-alerts.js'
import { compareVersions, RuntimeConfigStore } from './runtime-config.js'
import { createDatabase, type DatabaseContext } from './db/client.js'
import {
  accounts,
  analyticsAccountFacts,
  analyticsEvents,
  authSessions,
  clientErrorReports,
  contentReleases,
  favoriteStates,
  feedback,
  guestIdentities,
  learningActivityEvents,
  reviewStates,
  reviewScheduleOccurrences,
  syncRequests,
  trainingCompletions,
  trainingProgressStates,
  userPreferences,
  wechatIdentities,
} from './db/schema.js'

const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000
const MAX_FUTURE_MS = 5 * 60 * 1000
const ANALYTICS_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000

function hashSecret(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

function serializeCompletion(row: typeof trainingCompletions.$inferSelect): TrainingCompletion {
  return {
    syncId: row.syncId,
    sessionId: row.sessionId,
    contentVersion: row.contentVersion,
    selectedOptionId: row.selectedOptionId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
  }
}

type Principal = { accountId: string; authType: 'guest' | 'wechat'; createdAt: Date }

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  database: DatabaseContext,
): Promise<Principal | null> {
  const authorization = request.headers.authorization
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!token) {
    error(reply, 401, 'unauthorized', '需要账号身份。')
    return null
  }
  const [row] = await database.db.select({
    sessionId: authSessions.id,
    accountId: accounts.id,
    authType: accounts.authType,
    createdAt: accounts.createdAt,
  }).from(authSessions).innerJoin(accounts, eq(authSessions.accountId, accounts.id))
    .where(and(eq(authSessions.tokenHash, hashSecret(token)), gt(authSessions.expiresAt, new Date())))
    .limit(1)
  if (!row) {
    error(reply, 401, 'session_expired', '账号身份已过期。')
    return null
  }
  await database.db.update(authSessions).set({ lastUsedAt: new Date() }).where(eq(authSessions.id, row.sessionId))
  return { accountId: row.accountId, authType: row.authType, createdAt: row.createdAt }
}

async function issueSession(database: DatabaseContext, accountId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
  await database.db.insert(authSessions).values({ accountId, tokenHash: hashSecret(token), expiresAt })
  return { token, expiresAt: expiresAt.toISOString() }
}

async function readBundles(database: DatabaseContext) {
  const rows = await database.db.select({ bundle: contentReleases.bundle }).from(contentReleases)
    .orderBy(desc(contentReleases.releaseVersion))
  return rows.flatMap(({ bundle }) => {
    const parsed = TrainingContentBundleSchema.safeParse(bundle)
    return parsed.success ? [parsed.data] : []
  })
}

function matchingSession(bundles: TrainingContentBundle[], sessionId: string, version: number) {
  return bundles.flatMap((bundle) => {
    const session = bundle.sessions[sessionId]
    return session?.contentVersion === version ? [session] : []
  })[0]
}

function matchingReleaseSession(bundles: TrainingContentBundle[], releaseVersion: number, sessionId: string, contentVersion: number) {
  const bundle = bundles.find((item) => item.releaseVersion === releaseVersion)
  const session = bundle?.sessions[sessionId]
  return session?.contentVersion === contentVersion ? session : undefined
}

function localDateForOffset(occurredAt: string, offsetMinutes: number) {
  const local = new Date(Date.parse(occurredAt) - offsetMinutes * 60_000)
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`
}

function validAnalyticsContent(event: import('@microly/api-contract').AnalyticsEvent, bundles: TrainingContentBundle[]) {
  if (!['training_start', 'training_card_view', 'option_select', 'training_complete'].includes(event.name)) return true
  const properties = event.properties as Record<string, unknown>
  const session = matchingReleaseSession(bundles, Number(properties.releaseVersion), String(properties.sessionId), Number(properties.contentVersion))
  if (!session) return false
  if (event.name === 'training_card_view') {
    const card = session.cards[Number(event.properties.cardIndex)]
    return card?.id === event.properties.cardId && card.type === event.properties.cardType
  }
  if (event.name === 'option_select') {
    const choice = session.cards.find((card) => card.type === 'choice')
    const option = choice?.options[event.properties.displayPosition]
    return option?.id === event.properties.optionId && option.rating === event.properties.rating
  }
  return true
}

function isFuture(value: string | null | undefined) {
  return Boolean(value && Date.parse(value) > Date.now() + MAX_FUTURE_MS)
}

function candidateWins(candidate: { updatedAt: string }, stored: { updatedAt: string }) {
  const delta = Date.parse(candidate.updatedAt) - Date.parse(stored.updatedAt)
  return delta > 0 || (delta === 0 && JSON.stringify(candidate) > JSON.stringify(stored))
}

async function snapshot(database: DatabaseContext, accountId: string): Promise<SyncSnapshot> {
  const [preference, favorites, reviews, progress, activities] = await Promise.all([
    database.db.select().from(userPreferences).where(eq(userPreferences.accountId, accountId)).limit(1),
    database.db.select().from(favoriteStates).where(eq(favoriteStates.accountId, accountId)),
    database.db.select().from(reviewStates).where(eq(reviewStates.accountId, accountId)),
    database.db.select().from(trainingProgressStates).where(eq(trainingProgressStates.accountId, accountId)),
    database.db.select().from(learningActivityEvents).where(eq(learningActivityEvents.accountId, accountId)),
  ])
  return {
    preference: preference[0]?.value ?? null,
    favorites: favorites.map((row) => FavoriteSyncRecordSchema.parse(row.value)),
    reviews: reviews.map((row) => ReviewSyncRecordSchema.parse(row.value)),
    progress: progress.map((row) => TrainingProgressSyncRecordSchema.parse(row.value)),
    activities: activities.map((row) => LearningActivitySyncRecordSchema.parse(row.value)),
    serverTime: new Date().toISOString(),
  }
}

async function mergeAccounts(database: DatabaseContext, sourceId: string, targetId: string) {
  if (sourceId === targetId) return
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`INSERT INTO user_preferences (account_id, value, updated_at)
      SELECT $2, value, updated_at FROM user_preferences WHERE account_id = $1
      ON CONFLICT (account_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE excluded.updated_at > user_preferences.updated_at`, [sourceId, targetId])
    await client.query('DELETE FROM user_preferences WHERE account_id = $1', [sourceId])
    for (const [table, key, extra] of [
      ['favorite_states', 'favorite_id', ', active'],
      ['review_states', 'review_id', ''],
      ['training_progress_states', 'session_id', ''],
    ] as const) {
      await client.query(`INSERT INTO ${table} (account_id, ${key}, value${extra}, updated_at)
        SELECT $2, ${key}, value${extra}, updated_at FROM ${table} WHERE account_id = $1
        ON CONFLICT (account_id, ${key}) DO UPDATE SET value = excluded.value${extra ? ', active = excluded.active' : ''}, updated_at = excluded.updated_at
        WHERE excluded.updated_at > ${table}.updated_at`, [sourceId, targetId])
      await client.query(`DELETE FROM ${table} WHERE account_id = $1`, [sourceId])
    }
    await client.query(`UPDATE training_completions source SET account_id = $2 WHERE source.account_id = $1
      AND NOT EXISTS (SELECT 1 FROM training_completions target WHERE target.account_id = $2 AND target.sync_id = source.sync_id)`, [sourceId, targetId])
    await client.query('DELETE FROM training_completions WHERE account_id = $1', [sourceId])
    await client.query('UPDATE analytics_events SET account_id = $2 WHERE account_id = $1', [sourceId, targetId])
    await client.query(`INSERT INTO analytics_account_facts (account_id, first_opened_at, first_opened_local_date, timezone_offset_minutes)
      SELECT $2, first_opened_at, first_opened_local_date, timezone_offset_minutes FROM analytics_account_facts WHERE account_id = $1
      ON CONFLICT (account_id) DO UPDATE SET first_opened_at = LEAST(analytics_account_facts.first_opened_at, excluded.first_opened_at),
      first_opened_local_date = LEAST(analytics_account_facts.first_opened_local_date, excluded.first_opened_local_date),
      timezone_offset_minutes = CASE WHEN excluded.first_opened_at < analytics_account_facts.first_opened_at THEN excluded.timezone_offset_minutes ELSE analytics_account_facts.timezone_offset_minutes END,
      updated_at = now()`, [sourceId, targetId])
    await client.query('DELETE FROM analytics_account_facts WHERE account_id = $1', [sourceId])
    await client.query(`INSERT INTO review_schedule_occurrences (account_id, review_id, session_id, content_version, scheduled_due_at, interval_days, answered_at, created_at, updated_at)
      SELECT $2, review_id, session_id, content_version, scheduled_due_at, interval_days, answered_at, created_at, updated_at
      FROM review_schedule_occurrences WHERE account_id = $1
      ON CONFLICT (account_id, review_id, scheduled_due_at) DO UPDATE SET answered_at = COALESCE(review_schedule_occurrences.answered_at, excluded.answered_at), updated_at = now()`, [sourceId, targetId])
    await client.query('DELETE FROM review_schedule_occurrences WHERE account_id = $1', [sourceId])
    await client.query('UPDATE client_error_reports SET account_id = $2 WHERE account_id = $1', [sourceId, targetId])
    await client.query('UPDATE feedback SET account_id = $2 WHERE account_id = $1', [sourceId, targetId])
    await client.query(`UPDATE learning_activity_events source SET account_id = $2 WHERE source.account_id = $1
      AND NOT EXISTS (SELECT 1 FROM learning_activity_events target WHERE target.account_id = $2 AND target.event_id = source.event_id)`, [sourceId, targetId])
    await client.query('DELETE FROM learning_activity_events WHERE account_id = $1', [sourceId])
    await client.query('UPDATE guest_identities SET account_id = $2 WHERE account_id = $1', [sourceId, targetId])
    await client.query('DELETE FROM auth_sessions WHERE account_id = $1', [sourceId])
    await client.query('DELETE FROM accounts WHERE id = $1', [sourceId])
    await client.query('COMMIT')
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally {
    client.release()
  }
}

export interface CreateAppOptions {
  databaseUrl: string
  logger?: boolean
  wechat?: { appId: string; appSecret: string; identityHashSecret: string }
  exchangeWechatCode?: (code: string) => Promise<{ openid: string }>
  admin?: { token: string; origins: string[] }
  ai?: { apiKey: string; inputHashSecret: string; baseUrl?: string }
  aiProvider?: AiProvider
  runtime?: { environment: 'development' | 'test' | 'production'; appVersion: string; apiPublicOrigin?: string; adminPublicOrigin?: string }
  alerts?: { webhookUrl: string; cooldownMinutes: number; fetcher?: typeof fetch }
}

export function createApp(options: CreateAppOptions) {
  const database = createDatabase(options.databaseUrl)
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 })
  const runtimeMetrics = new RuntimeMetrics()
  const runtime = options.runtime ?? { environment: 'development' as const, appVersion: '1.0.0' }
  const runtimeConfig = new RuntimeConfigStore(database, runtime.environment, runtime.appVersion)
  app.addHook('onRequest', async (request) => { runtimeMetrics.start(request) })
  app.addHook('onResponse', async (request, reply) => { runtimeMetrics.finish(request, reply) })
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Microly-Api-Version', runtime.appVersion)
    return payload
  })
  const exchangeWechatCode = options.exchangeWechatCode ?? (async (code: string) => {
    if (!options.wechat) throw new Error('Wechat login is not configured')
    const query = new URLSearchParams({ appid: options.wechat.appId, secret: options.wechat.appSecret, js_code: code, grant_type: 'authorization_code' })
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, { signal: AbortSignal.timeout(8000) })
    const value = await response.json() as { openid?: string; errcode?: number }
    if (!response.ok || !value.openid || value.errcode) throw new Error('Wechat code exchange failed')
    return { openid: value.openid }
  })

  const alertMonitor = options.alerts ? new RuntimeAlertMonitor({
    database, metrics: runtimeMetrics, webhookUrl: options.alerts.webhookUrl,
    cooldownMinutes: options.alerts.cooldownMinutes, environment: runtime.environment,
    appVersion: runtime.appVersion, logger: app.log, fetcher: options.alerts.fetcher,
  }) : undefined
  app.addHook('onReady', async () => { alertMonitor?.start() })
  app.addHook('onClose', async () => { alertMonitor?.stop(); await database.pool.end() })
  app.setErrorHandler((cause, _request, reply) => {
    if (cause instanceof ZodError) return error(reply, 400, 'invalid_request', '请求内容不符合接口约定。')
    if (typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 400) {
      return error(reply, 400, 'invalid_request', '请求内容不符合接口约定。')
    }
    app.log.error(cause)
    return error(reply, 500, 'internal_error', '服务暂时不可用。')
  })

  app.get('/health/live', async (_request, reply) => reply.send({ data: { process: 'ok', version: runtime.appVersion } }))

  const readiness = async () => {
    try {
      const [databaseStatus, content, migration] = await Promise.all([
        database.pool.query('SELECT 1'),
        database.pool.query('SELECT release_version,bundle FROM content_releases ORDER BY release_version DESC LIMIT 1'),
        database.pool.query('SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1'),
      ])
      void databaseStatus
      const contentAvailable = Boolean(content.rows[0] && TrainingContentBundleSchema.safeParse(content.rows[0].bundle).success)
      const data = {
        process: 'ok' as const, database: 'ok' as const,
        content: contentAvailable ? 'ok' as const : 'unavailable' as const,
        migrations: migration.rows[0]?.filename === '0007_beta_release.sql' ? 'ok' as const : 'pending' as const,
        version: runtime.appVersion,
      }
      return { status: data.content === 'ok' && data.migrations === 'ok' ? 200 : 503, data }
    } catch {
      return { status: 503, data: { process: 'ok' as const, database: 'unavailable' as const, content: 'unavailable' as const, migrations: 'unknown' as const, version: runtime.appVersion } }
    }
  }
  app.get('/health', async (_request, reply) => { const result = await readiness(); return reply.status(result.status).send({ data: result.data }) })
  app.get('/health/ready', async (_request, reply) => { const result = await readiness(); return reply.status(result.status).send({ data: result.data }) })

  app.get('/v1/runtime-config', async (_request, reply) => {
    const value = await runtimeConfig.read()
    return reply.header('Cache-Control', 'public, max-age=30').send({ data: value })
  })

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url
    if (path.startsWith('/health') || path.startsWith('/v1/admin/') || path === '/v1/runtime-config' || request.method === 'OPTIONS') return
    const settings = await runtimeConfig.read()
    const appVersion = request.headers['x-microly-app-version']
    const safe = request.method === 'GET' || request.method === 'HEAD' || path === '/v1/auth/logout' || (path === '/v1/account' && request.method === 'DELETE')
    if (!safe && runtime.environment === 'production' && (typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+/u.test(appVersion))) {
      return error(reply, 426, 'app_version_required', '当前客户端需要更新后才能继续联网操作。')
    }
    if (!safe && typeof appVersion === 'string' && /^\d+\.\d+\.\d+/u.test(appVersion) && compareVersions(appVersion, settings.minimumSupportedVersion) < 0) {
      return error(reply, 426, 'app_update_required', '当前版本需要更新后才能继续联网操作。')
    }
    if (!safe && settings.maintenance.active) return error(reply, 503, 'maintenance_mode', settings.maintenance.message ?? '服务维护中，请稍后重试。')
    if (path === '/v1/auth/wechat' && !settings.features.wechatLogin) return error(reply, 503, 'feature_disabled', '微信登录暂时不可用。')
    if (!settings.features.accountSync && !safe && (path === '/v1/sync' || path === '/v1/training-completions')) return error(reply, 503, 'sync_paused', '同步暂时暂停，本机数据会稍后重试。')
    if (!settings.features.aiEvaluation && !safe && path.startsWith('/v1/ai/')) return error(reply, 503, 'ai_unavailable', 'AI 点评暂时不可用。')
    if (!settings.features.feedback && path === '/v1/feedback' && request.method === 'POST') return error(reply, 503, 'feature_disabled', '意见反馈暂时不可用。')
  })

  const aiProvider = options.aiProvider ?? (options.ai ? createDeepseekProvider(options.ai.apiKey, options.ai.baseUrl) : undefined)
  registerAiRoutes(app, database, {
    provider: aiProvider,
    inputHashSecret: options.ai?.inputHashSecret ?? (options.aiProvider ? 'integration-test-ai-input-secret-32chars' : undefined),
    authenticate: (request, reply) => authenticate(request, reply, database),
  })

  app.get('/v1/content/current', async (request, reply) => {
    const [release] = await database.db.select().from(contentReleases).orderBy(desc(contentReleases.releaseVersion)).limit(1)
    if (!release) return error(reply, 404, 'content_unavailable', '暂无已发布课程。')
    const etag = `"${release.checksum}"`
    reply.header('ETag', etag).header('Cache-Control', 'no-cache')
    if (request.headers['if-none-match'] === etag) return reply.status(304).send()
    return reply.send({ data: { bundle: TrainingContentBundleSchema.parse(release.bundle), checksum: release.checksum } })
  })

  app.post('/v1/auth/guest', async (request, reply) => {
    const { installationId } = GuestAuthRequestSchema.parse(request.body)
    const installationHash = hashSecret(installationId)
    let [guest] = await database.db.select().from(guestIdentities).where(eq(guestIdentities.installationHash, installationHash)).limit(1)
    if (!guest) {
      const [account] = await database.db.insert(accounts).values({}).returning()
      if (!account) throw new Error('Account was not created')
      const inserted = await database.db.insert(guestIdentities).values({ accountId: account.id, installationHash })
        .onConflictDoNothing({ target: guestIdentities.installationHash }).returning()
      ;[guest] = inserted
      if (!guest) {
        await database.db.delete(accounts).where(eq(accounts.id, account.id))
        ;[guest] = await database.db.select().from(guestIdentities).where(eq(guestIdentities.installationHash, installationHash)).limit(1)
      }
    }
    if (!guest) throw new Error('Guest identity was not created')
    const [account] = await database.db.select().from(accounts).where(eq(accounts.id, guest.accountId)).limit(1)
    if (!account) throw new Error('Guest account was not found')
    const session = await issueSession(database, guest.accountId)
    return reply.send({ data: { guestId: guest.id, accountId: guest.accountId, authType: account.authType, ...session } })
  })

  app.post('/v1/auth/wechat', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    if (!options.wechat && !options.exchangeWechatCode) {
      return error(reply, 503, 'wechat_not_configured', '本地 API 尚未配置微信登录。')
    }
    const { code } = WechatAuthRequestSchema.parse(request.body)
    let openid: string
    try { ({ openid } = await exchangeWechatCode(code)) } catch { return error(reply, 502, 'wechat_login_failed', '微信登录暂时不可用。') }
    const appId = options.wechat?.appId ?? 'test-app'
    const secret = options.wechat?.identityHashSecret ?? 'test-identity-secret'
    const openidHash = createHmac('sha256', secret).update(`${appId}:${openid}`).digest('hex')
    const [identity] = await database.db.select().from(wechatIdentities)
      .where(and(eq(wechatIdentities.appId, appId), eq(wechatIdentities.openidHash, openidHash))).limit(1)
    if (principal.authType === 'wechat' && identity?.accountId !== principal.accountId) {
      return error(reply, 409, 'ACCOUNT_CONFLICT', '当前账号已绑定其他微信身份。')
    }
    const targetId = identity?.accountId ?? principal.accountId
    if (identity && targetId !== principal.accountId) await mergeAccounts(database, principal.accountId, targetId)
    if (!identity) {
      await database.db.insert(wechatIdentities).values({ accountId: targetId, appId, openidHash })
      await database.db.update(accounts).set({ authType: 'wechat', updatedAt: new Date() }).where(eq(accounts.id, targetId))
    }
    const session = await issueSession(database, targetId)
    return reply.send({ data: { accountId: targetId, authType: 'wechat', merged: targetId !== principal.accountId, ...session } })
  })

  app.get('/v1/account', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    return reply.send({ data: { accountId: principal.accountId, authType: principal.authType, createdAt: principal.createdAt.toISOString() } })
  })

  app.post('/v1/auth/logout', async (request, reply) => {
    const authorization = request.headers.authorization
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    if (token) await database.db.delete(authSessions).where(eq(authSessions.tokenHash, hashSecret(token)))
    return reply.send({ data: { loggedOut: true } })
  })

  app.delete('/v1/account', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const body = request.body as { confirmation?: unknown }
    if (body?.confirmation !== 'DELETE') return error(reply, 400, 'confirmation_required', '请确认注销账号。')
    await database.db.delete(accounts).where(eq(accounts.id, principal.accountId))
    return reply.send({ data: { deleted: true } })
  })

  app.get('/v1/training-completions', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const rows = await database.db.select().from(trainingCompletions)
      .where(eq(trainingCompletions.accountId, principal.accountId)).orderBy(trainingCompletions.completedAt)
    return reply.send({ data: rows.map(serializeCompletion) })
  })

  app.post('/v1/training-completions', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const completion = TrainingCompletionSchema.parse(request.body)
    if (isFuture(completion.startedAt) || isFuture(completion.completedAt)) return error(reply, 422, 'future_timestamp', '完成记录时间超出允许范围。')
    const session = matchingSession(await readBundles(database), completion.sessionId, completion.contentVersion)
    const choice = session?.cards.find((card) => card.type === 'choice')
    if (!choice?.options.some((option) => option.id === completion.selectedOptionId)) return error(reply, 422, 'invalid_completion', '训练版本或选项不存在。')
    const inserted = await database.db.insert(trainingCompletions).values({
      accountId: principal.accountId, syncId: completion.syncId, sessionId: completion.sessionId,
      contentVersion: completion.contentVersion, selectedOptionId: completion.selectedOptionId,
      startedAt: new Date(completion.startedAt), completedAt: new Date(completion.completedAt),
    }).onConflictDoNothing({ target: [trainingCompletions.accountId, trainingCompletions.syncId] }).returning()
    const [stored] = inserted.length ? inserted : await database.db.select().from(trainingCompletions)
      .where(and(eq(trainingCompletions.accountId, principal.accountId), eq(trainingCompletions.syncId, completion.syncId))).limit(1)
    if (!stored) throw new Error('Training completion was not stored')
    return reply.status(inserted.length ? 201 : 200).send({ data: serializeCompletion(stored) })
  })

  app.get('/v1/sync', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    return reply.send({ data: await snapshot(database, principal.accountId) })
  })

  app.post('/v1/sync', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const input = SyncRequestSchema.parse(request.body)
    const bundles = await readBundles(database)
    if (input.activities.some((value) => value.type === 'due_review_answered' && (!value.scheduledDueAt || !value.intervalDaysBefore))) {
      return error(reply, 422, 'review_occurrence_required', '到期复习记录缺少计划到期时间或复习前间隔。')
    }
    const timestamps = [
      input.preference?.completedAt, input.preference?.updatedAt,
      ...input.favorites.flatMap((v) => [v.createdAt, v.updatedAt]),
      ...input.reviews.flatMap((v) => [v.createdAt, v.updatedAt, v.lastReviewedAt]),
      ...input.progress.flatMap((v) => [v.startedAt, v.updatedAt, v.completedAt]),
      ...input.activities.map((v) => v.occurredAt),
    ]
    if (timestamps.some(isFuture)) return error(reply, 422, 'future_timestamp', '同步时间超出允许范围。')
    const invalidContent = [
      ...input.favorites.map((v) => v.favoriteId === `${v.sessionId}:${v.cardId}` && matchingSession(bundles, v.sessionId, v.contentVersion)?.cards.some((c) => c.id === v.cardId && c.type === 'principle')),
      ...input.reviews.map((v) => {
        const session = matchingSession(bundles, v.sessionId, v.contentVersion)
        const options = v.lastVariantId
          ? session?.reviewVariants.find((variant) => variant.variantId === v.lastVariantId)?.options
          : session?.cards.flatMap((card) => card.type === 'choice' && card.id === v.sourceCardId ? [card.options] : [])[0]
        return v.reviewId === `${v.sessionId}:choice` && Boolean(options?.some((option) => option.id === v.lastSelectedOptionId))
      }),
      ...input.progress.map((v) => { const s = matchingSession(bundles, v.sessionId, v.contentVersion); return s && v.currentCardIndex < s.cards.length && (!v.selectedOptionId || s.cards.some((c) => c.type === 'choice' && c.options.some((o) => o.id === v.selectedOptionId))) }),
      ...input.activities.map((v) => {
        const sessions = bundles.map((bundle) => bundle.sessions[v.sessionId]).filter((session): session is NonNullable<typeof session> => Boolean(session))
        if (!sessions.length) return false
        if (v.type === 'due_review_answered' && v.variantId) return sessions.some((session) => session.reviewVariants.some((variant) => variant.variantId === v.variantId))
        return true
      }),
    ].some((valid) => !valid)
    if (invalidContent) return error(reply, 422, 'invalid_sync_content', '同步记录引用了无效课程内容。')
    await database.db.transaction(async (tx) => {
      const already = await tx.select().from(syncRequests).where(and(eq(syncRequests.accountId, principal.accountId), eq(syncRequests.requestId, input.requestId))).limit(1)
      if (already.length) return
      if (input.preference) {
        const [stored] = await tx.select().from(userPreferences).where(eq(userPreferences.accountId, principal.accountId)).limit(1)
        if (!stored || candidateWins(input.preference, stored.value)) await tx.insert(userPreferences).values({ accountId: principal.accountId, value: input.preference, updatedAt: new Date(input.preference.updatedAt) }).onConflictDoUpdate({ target: userPreferences.accountId, set: { value: input.preference, updatedAt: new Date(input.preference.updatedAt) } })
      }
      for (const value of input.favorites) {
        const [stored] = await tx.select().from(favoriteStates).where(and(eq(favoriteStates.accountId, principal.accountId), eq(favoriteStates.favoriteId, value.favoriteId))).limit(1)
        if (!stored || candidateWins(value, stored.value)) await tx.insert(favoriteStates).values({ accountId: principal.accountId, favoriteId: value.favoriteId, value, active: value.active, updatedAt: new Date(value.updatedAt) }).onConflictDoUpdate({ target: [favoriteStates.accountId, favoriteStates.favoriteId], set: { value, active: value.active, updatedAt: new Date(value.updatedAt) } })
      }
      for (const value of input.reviews) {
        const [stored] = await tx.select().from(reviewStates).where(and(eq(reviewStates.accountId, principal.accountId), eq(reviewStates.reviewId, value.reviewId))).limit(1)
        if (!stored || candidateWins(value, stored.value)) await tx.insert(reviewStates).values({ accountId: principal.accountId, reviewId: value.reviewId, value, updatedAt: new Date(value.updatedAt) }).onConflictDoUpdate({ target: [reviewStates.accountId, reviewStates.reviewId], set: { value, updatedAt: new Date(value.updatedAt) } })
        await tx.insert(reviewScheduleOccurrences).values({
          accountId: principal.accountId, reviewId: value.reviewId, sessionId: value.sessionId,
          contentVersion: value.contentVersion, scheduledDueAt: new Date(value.dueAt), intervalDays: value.intervalDays,
        }).onConflictDoNothing({ target: [reviewScheduleOccurrences.accountId, reviewScheduleOccurrences.reviewId, reviewScheduleOccurrences.scheduledDueAt] })
      }
      for (const value of input.progress) {
        const [stored] = await tx.select().from(trainingProgressStates).where(and(eq(trainingProgressStates.accountId, principal.accountId), eq(trainingProgressStates.sessionId, value.sessionId))).limit(1)
        const sameAttemptCompleted = stored?.value.attemptId === value.attemptId && stored.value.status === 'completed' && value.status !== 'completed'
        if (!sameAttemptCompleted && (!stored || candidateWins(value, stored.value))) await tx.insert(trainingProgressStates).values({ accountId: principal.accountId, sessionId: value.sessionId, value, updatedAt: new Date(value.updatedAt) }).onConflictDoUpdate({ target: [trainingProgressStates.accountId, trainingProgressStates.sessionId], set: { value, updatedAt: new Date(value.updatedAt) } })
      }
      for (const value of input.activities) {
        await tx.insert(learningActivityEvents).values({ eventId: value.eventId, accountId: principal.accountId, value, occurredAt: new Date(value.occurredAt) }).onConflictDoNothing({ target: [learningActivityEvents.accountId, learningActivityEvents.eventId] })
        if (value.type === 'due_review_answered' && value.scheduledDueAt && value.intervalDaysBefore) {
          await tx.insert(reviewScheduleOccurrences).values({
            accountId: principal.accountId, reviewId: value.reviewId, sessionId: value.sessionId,
            contentVersion: input.reviews.find((review) => review.reviewId === value.reviewId)?.contentVersion ?? 1,
            scheduledDueAt: new Date(value.scheduledDueAt), intervalDays: value.intervalDaysBefore,
            answeredAt: new Date(value.occurredAt), updatedAt: new Date(),
          }).onConflictDoUpdate({
            target: [reviewScheduleOccurrences.accountId, reviewScheduleOccurrences.reviewId, reviewScheduleOccurrences.scheduledDueAt],
            set: { answeredAt: new Date(value.occurredAt), updatedAt: new Date() },
          })
        }
      }
      await tx.insert(syncRequests).values({ requestId: input.requestId, accountId: principal.accountId })
        .onConflictDoNothing({ target: [syncRequests.accountId, syncRequests.requestId] })
    })
    return reply.send({ data: await snapshot(database, principal.accountId) })
  })

  app.post('/v1/feedback', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const value = FeedbackRequestSchema.parse(request.body)
    if (value.sessionId && !matchingSession(await readBundles(database), value.sessionId, value.contentVersion as number)) return error(reply, 422, 'invalid_feedback_context', '反馈的课程上下文无效。')
    const [stored] = await database.db.insert(feedback).values({ accountId: principal.accountId, ...value }).returning()
    if (!stored) throw new Error('Feedback was not stored')
    return reply.status(201).send({ data: { feedbackId: stored.id, status: 'new' } })
  })

  app.post('/v1/events/batch', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const batch = AnalyticsBatchRequestSchema.parse(request.body)
    const now = Date.now()
    if (batch.events.some((event) => {
      const occurred = Date.parse(event.occurredAt)
      return occurred > now + MAX_FUTURE_MS
        || occurred < now - ANALYTICS_MAX_AGE_MS
        || event.localDateKey !== localDateForOffset(event.occurredAt, event.timezoneOffsetMinutes)
    })) return error(reply, 422, 'invalid_event_timestamp', '埋点时间或设备自然日无效。')
    const bundles = await readBundles(database)
    if (batch.events.some((event) => !validAnalyticsContent(event, bundles))) {
      return error(reply, 422, 'invalid_event_content', '埋点引用了无效课程内容。')
    }
    await database.pool.query(`DELETE FROM analytics_events WHERE received_at < now() - interval '90 days'`)
    let accepted = 0
    for (const event of batch.events) {
      const inserted = await database.db.insert(analyticsEvents).values({
        eventId: event.eventId, accountId: principal.accountId, visitId: event.visitId, name: event.name,
        occurredAt: new Date(event.occurredAt), localDateKey: event.localDateKey,
        timezoneOffsetMinutes: event.timezoneOffsetMinutes, properties: event.properties,
      }).onConflictDoNothing({ target: analyticsEvents.eventId }).returning({ eventId: analyticsEvents.eventId })
      accepted += inserted.length
      if (event.name === 'app_open') {
        await database.db.insert(analyticsAccountFacts).values({
          accountId: principal.accountId, firstOpenedAt: new Date(event.occurredAt),
          firstOpenedLocalDate: event.localDateKey, timezoneOffsetMinutes: event.timezoneOffsetMinutes,
        }).onConflictDoUpdate({
          target: analyticsAccountFacts.accountId,
          set: { updatedAt: new Date() },
        })
        await database.pool.query(`UPDATE analytics_account_facts SET
          first_opened_at = LEAST(first_opened_at, $2::timestamptz),
          first_opened_local_date = LEAST(first_opened_local_date, $3::date),
          timezone_offset_minutes = CASE WHEN $2::timestamptz < first_opened_at THEN $4 ELSE timezone_offset_minutes END,
          updated_at = now() WHERE account_id = $1`, [principal.accountId, event.occurredAt, event.localDateKey, event.timezoneOffsetMinutes])
      }
    }
    return reply.send({ data: { accepted } })
  })

  app.post('/v1/client-errors/batch', async (request, reply) => {
    const principal = await authenticate(request, reply, database)
    if (!principal) return
    const { reports } = ClientErrorBatchRequestSchema.parse(request.body)
    await database.pool.query(`DELETE FROM client_error_reports WHERE received_at < now() - interval '30 days'`)
    const existingIds = await database.pool.query('SELECT report_id FROM client_error_reports WHERE report_id = ANY($1::uuid[])', [reports.map((report) => report.reportId)])
    const existing = new Set(existingIds.rows.map((row) => row.report_id as string))
    const newCount = reports.filter((report) => !existing.has(report.reportId)).length
    const rate = await database.pool.query(`SELECT count(*)::int AS count FROM client_error_reports
      WHERE account_id = $1 AND received_at >= now() - interval '1 hour'`, [principal.accountId])
    if (Number(rate.rows[0]?.count ?? 0) + newCount > 100) {
      return error(reply, 429, 'client_error_rate_limited', '错误报告过于频繁，请稍后再试。')
    }
    const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000
    if (reports.some((report) => Date.parse(report.occurredAt) < cutoff || isFuture(report.occurredAt))) {
      return error(reply, 422, 'invalid_error_timestamp', '错误报告时间超出允许范围。')
    }
    let accepted = 0
    for (const report of reports) {
      const inserted = await database.db.insert(clientErrorReports).values({
        reportId: report.reportId,
        accountId: principal.accountId,
        fingerprint: report.fingerprint,
        category: report.category,
        severity: report.severity,
        page: report.page,
        appVersion: report.appVersion,
        contentVersion: report.contentVersion ?? null,
        networkType: report.networkType,
        errorCode: report.errorCode ?? null,
        stackDigest: report.stackDigest ?? null,
        occurredAt: new Date(report.occurredAt),
      }).onConflictDoNothing({ target: clientErrorReports.reportId }).returning({ id: clientErrorReports.id })
      accepted += inserted.length
    }
    return reply.send({ data: { accepted, duplicates: reports.length - accepted } })
  })

  registerAdminRoutes(app, database, options.admin, {
    provider: aiProvider, configured: Boolean(options.ai || options.aiProvider), runtimeMetrics,
    runtimeConfig, runtime,
  })

  return app
}
