import { createHash, createHmac, randomBytes } from 'node:crypto'

import {
  AnalyticsBatchRequestSchema,
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
import { createDatabase, type DatabaseContext } from './db/client.js'
import {
  accounts,
  analyticsEvents,
  authSessions,
  contentReleases,
  favoriteStates,
  feedback,
  guestIdentities,
  learningActivityEvents,
  reviewStates,
  syncRequests,
  trainingCompletions,
  trainingProgressStates,
  userPreferences,
  wechatIdentities,
} from './db/schema.js'

const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000
const MAX_FUTURE_MS = 5 * 60 * 1000

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
}

export function createApp(options: CreateAppOptions) {
  const database = createDatabase(options.databaseUrl)
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 })
  const exchangeWechatCode = options.exchangeWechatCode ?? (async (code: string) => {
    if (!options.wechat) throw new Error('Wechat login is not configured')
    const query = new URLSearchParams({ appid: options.wechat.appId, secret: options.wechat.appSecret, js_code: code, grant_type: 'authorization_code' })
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, { signal: AbortSignal.timeout(8000) })
    const value = await response.json() as { openid?: string; errcode?: number }
    if (!response.ok || !value.openid || value.errcode) throw new Error('Wechat code exchange failed')
    return { openid: value.openid }
  })

  app.addHook('onClose', async () => database.pool.end())
  app.setErrorHandler((cause, _request, reply) => {
    if (cause instanceof ZodError) return error(reply, 400, 'invalid_request', '请求内容不符合接口约定。')
    if (typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 400) {
      return error(reply, 400, 'invalid_request', '请求内容不符合接口约定。')
    }
    app.log.error(cause)
    return error(reply, 500, 'internal_error', '服务暂时不可用。')
  })

  app.get('/health', async (_request, reply) => {
    try {
      await database.pool.query('SELECT 1')
      return reply.send({ data: { process: 'ok', database: 'ok' } })
    } catch {
      return reply.status(503).send({ data: { process: 'ok', database: 'unavailable' } })
    }
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
      ...input.reviews.map((v) => v.reviewId === `${v.sessionId}:choice` && matchingSession(bundles, v.sessionId, v.contentVersion)?.cards.some((c) => c.id === v.sourceCardId && c.type === 'choice' && c.options.some((o) => o.id === v.lastSelectedOptionId))),
      ...input.progress.map((v) => { const s = matchingSession(bundles, v.sessionId, v.contentVersion); return s && v.currentCardIndex < s.cards.length && (!v.selectedOptionId || s.cards.some((c) => c.type === 'choice' && c.options.some((o) => o.id === v.selectedOptionId))) }),
      ...input.activities.map((v) => Boolean(bundles.some((b) => b.sessions[v.sessionId]))),
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
      }
      for (const value of input.progress) {
        const [stored] = await tx.select().from(trainingProgressStates).where(and(eq(trainingProgressStates.accountId, principal.accountId), eq(trainingProgressStates.sessionId, value.sessionId))).limit(1)
        const sameAttemptCompleted = stored?.value.attemptId === value.attemptId && stored.value.status === 'completed' && value.status !== 'completed'
        if (!sameAttemptCompleted && (!stored || candidateWins(value, stored.value))) await tx.insert(trainingProgressStates).values({ accountId: principal.accountId, sessionId: value.sessionId, value, updatedAt: new Date(value.updatedAt) }).onConflictDoUpdate({ target: [trainingProgressStates.accountId, trainingProgressStates.sessionId], set: { value, updatedAt: new Date(value.updatedAt) } })
      }
      for (const value of input.activities) await tx.insert(learningActivityEvents).values({ eventId: value.eventId, accountId: principal.accountId, value, occurredAt: new Date(value.occurredAt) }).onConflictDoNothing({ target: [learningActivityEvents.accountId, learningActivityEvents.eventId] })
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
    let accepted = 0
    for (const event of batch.events) {
      const inserted = await database.db.insert(analyticsEvents).values({ eventId: event.eventId, accountId: principal.accountId, name: event.name, occurredAt: new Date(event.occurredAt), properties: event.properties }).onConflictDoNothing({ target: analyticsEvents.eventId }).returning({ eventId: analyticsEvents.eventId })
      accepted += inserted.length
    }
    return reply.send({ data: { accepted } })
  })

  registerAdminRoutes(app, database, options.admin)

  return app
}
