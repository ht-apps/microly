import { createHash, timingSafeEqual } from 'node:crypto'

import {
  AdminAiConfigUpdateRequestSchema,
  AdminDraftCreateRequestSchema,
  AdminDraftUpdateRequestSchema,
  AdminFeedbackStatusSchema,
  AdminFeedbackUpdateRequestSchema,
  AdminPublishRequestSchema,
  AdminWithdrawRequestSchema,
} from '@microly/api-contract'
import { TrainingContentBundleSchema, type TrainingContentBundle } from '@microly/content-schema'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { DatabaseContext } from './db/client.js'
import { checksumBundle } from './db/seed.js'
import type { AiProvider } from './ai.js'

const feedbackCategories = ['content_error', 'product_suggestion', 'inappropriate_content'] as const
const funnelNames = ['app_open', 'onboarding_view', 'training_start', 'option_select', 'training_complete', 'wechat_login_success'] as const

type AdminOptions = { token: string; origins: string[] }
type ValidationIssue = { path: string; message: string; severity: 'error' | 'warning' }

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

function tokenMatches(expected: string, actual: string) {
  const expectedHash = createHash('sha256').update(expected).digest()
  const actualHash = createHash('sha256').update(actual).digest()
  return timingSafeEqual(expectedHash, actualHash)
}

async function authorizeAdmin(request: FastifyRequest, reply: FastifyReply, admin?: AdminOptions) {
  if (!admin) {
    sendError(reply, 503, 'admin_not_configured', '本地 API 尚未配置运营后台。')
    return false
  }
  const authorization = request.headers.authorization
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token || !tokenMatches(admin.token, token)) {
    sendError(reply, 401, 'admin_unauthorized', '管理令牌无效。')
    return false
  }
  return true
}

function issuePath(path: PropertyKey[]) {
  return path.map(String).join('.')
}

function contentWarnings(bundle: TrainingContentBundle): ValidationIssue[] {
  const warnings: ValidationIssue[] = []
  const sessionTitles = new Map<string, string>()
  Object.entries(bundle.sessions).forEach(([sessionId, session]) => {
    const existing = sessionTitles.get(session.title)
    if (existing) warnings.push({ path: `sessions.${sessionId}.title`, message: `训练标题与 ${existing} 重复。`, severity: 'warning' })
    else sessionTitles.set(session.title, sessionId)
    const choice = session.cards.find((card) => card.type === 'choice')
    if (choice) {
      const texts = new Set<string>()
      choice.options.forEach((option, index) => {
        if (texts.has(option.text)) warnings.push({ path: `sessions.${sessionId}.cards.1.options.${index}.text`, message: '选项文本重复。', severity: 'warning' })
        texts.add(option.text)
      })
    }
  })
  return warnings
}

export function validateContentBundle(value: unknown) {
  const parsed = TrainingContentBundleSchema.safeParse(value)
  const issues: ValidationIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message, severity: 'error' as const }))
  if (!parsed.success) return { valid: false, issues, bundle: null }

  const referencedCatalogs = new Set(parsed.data.library.catalogIds)
  const referencedSessions = new Set(Object.values(parsed.data.catalogs).flatMap((catalog) => catalog.sessionIds))
  Object.keys(parsed.data.catalogs).forEach((id) => {
    if (!referencedCatalogs.has(id)) issues.push({ path: `catalogs.${id}`, message: '章节未被课程库引用。', severity: 'error' })
  })
  Object.entries(parsed.data.sessions).forEach(([id, session]) => {
    if (!referencedSessions.has(id)) issues.push({ path: `sessions.${id}`, message: '训练未被任何章节引用。', severity: 'error' })
    if (session.riskLevel === 'high') issues.push({ path: `sessions.${id}.riskLevel`, message: '高风险训练不能在 MVP 中发布。', severity: 'error' })
  })
  issues.push(...contentWarnings(parsed.data))
  return { valid: !issues.some((issue) => issue.severity === 'error'), issues, bundle: parsed.data }
}

function withoutVersion<T extends Record<string, unknown>>(value: T, key: 'releaseVersion' | 'contentVersion') {
  const copy = structuredClone(value)
  delete copy[key]
  return JSON.stringify(copy)
}

function entityVersion(target: Record<string, unknown>, history: Record<string, unknown>[]) {
  const targetBody = withoutVersion(target, 'contentVersion')
  const exact = history.find((value) => withoutVersion(value, 'contentVersion') === targetBody)
  if (exact && typeof exact.contentVersion === 'number') return exact.contentVersion
  return Math.max(0, ...history.map((value) => typeof value.contentVersion === 'number' ? value.contentVersion : 0)) + 1
}

export function normalizeContentBundle(input: TrainingContentBundle, history: TrainingContentBundle[], releaseVersion: number) {
  const bundle = structuredClone(input)
  bundle.releaseVersion = releaseVersion
  bundle.library.contentVersion = entityVersion(bundle.library, history.map((value) => value.library))
  Object.entries(bundle.catalogs).forEach(([id, catalog]) => {
    const previous = history.flatMap((value) => value.catalogs[id] ? [value.catalogs[id] as unknown as Record<string, unknown>] : [])
    catalog.contentVersion = entityVersion(catalog as unknown as Record<string, unknown>, previous)
  })
  Object.entries(bundle.sessions).forEach(([id, session]) => {
    const previous = history.flatMap((value) => value.sessions[id] ? [value.sessions[id] as unknown as Record<string, unknown>] : [])
    session.contentVersion = entityVersion(session as unknown as Record<string, unknown>, previous)
  })
  return TrainingContentBundleSchema.parse(bundle)
}

function draftResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    baseReleaseVersion: row.base_release_version,
    bundle: row.bundle,
    status: row.status,
    revision: row.revision,
    publishedReleaseVersion: row.published_release_version,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  }
}

async function loadReleaseBundles(database: DatabaseContext) {
  const rows = await database.pool.query('SELECT bundle FROM content_releases ORDER BY release_version DESC')
  return rows.rows.flatMap(({ bundle }) => {
    const parsed = TrainingContentBundleSchema.safeParse(bundle)
    return parsed.success ? [parsed.data] : []
  })
}

async function publishDraft(database: DatabaseContext, draftId: string, revision: number, reason: string) {
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(706042)')
    const draftResult = await client.query('SELECT * FROM content_drafts WHERE id = $1 FOR UPDATE', [draftId])
    const draft = draftResult.rows[0]
    if (!draft) { await client.query('ROLLBACK'); return { error: 'not_found' as const } }
    if (draft.status !== 'draft') { await client.query('ROLLBACK'); return { error: 'not_editable' as const } }
    if (draft.revision !== revision) { await client.query('ROLLBACK'); return { error: 'conflict' as const } }
    const validation = validateContentBundle(draft.bundle)
    if (!validation.valid || !validation.bundle) { await client.query('ROLLBACK'); return { error: 'invalid' as const, issues: validation.issues } }
    const releases = await client.query('SELECT release_version, bundle FROM content_releases ORDER BY release_version DESC')
    const history = releases.rows.flatMap(({ bundle }) => {
      const parsed = TrainingContentBundleSchema.safeParse(bundle)
      return parsed.success ? [parsed.data] : []
    })
    const nextVersion = Number(releases.rows[0]?.release_version ?? 0) + 1
    const bundle = normalizeContentBundle(validation.bundle, history, nextVersion)
    const checksum = checksumBundle(bundle)
    await client.query(`INSERT INTO content_releases
      (release_version, bundle, checksum, source_draft_id, created_from_version, release_reason)
      VALUES ($1, $2::jsonb, $3, $4, $5, $6)`, [nextVersion, JSON.stringify(bundle), checksum, draftId, draft.base_release_version, reason])
    await client.query(`UPDATE content_drafts SET status = 'published', published_release_version = $2,
      revision = revision + 1, updated_at = now() WHERE id = $1`, [draftId, nextVersion])
    await client.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, reason, metadata)
      VALUES ('content.publish', 'release', $1, $2, $3::jsonb)`, [String(nextVersion), reason, JSON.stringify({ draftId })])
    await client.query('COMMIT')
    return { releaseVersion: nextVersion, checksum, bundle }
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally {
    client.release()
  }
}

export function registerAdminRoutes(app: FastifyInstance, database: DatabaseContext, admin?: AdminOptions, ai?: { provider?: AiProvider; configured: boolean }) {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (admin && origin && admin.origins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS')
    }
    if (request.method === 'OPTIONS') return reply.status(204).send()
  })

  app.options('/v1/admin/*', async (_request, reply) => reply.status(204).send())

  app.get('/v1/admin/session', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    return reply.send({ data: { authenticated: true } })
  })

  app.get('/v1/admin/content/releases', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const [releases, drafts] = await Promise.all([
      database.pool.query(`SELECT release_version, checksum, created_from_version, release_reason,
        published_at, bundle
        FROM content_releases ORDER BY release_version DESC`),
      database.pool.query(`SELECT * FROM content_drafts ORDER BY updated_at DESC`),
    ])
    return reply.send({ data: {
      currentVersion: releases.rows[0]?.release_version ?? null,
      releases: releases.rows.map((row) => ({
        releaseVersion: row.release_version,
        checksum: row.checksum,
        createdFromVersion: row.created_from_version,
        releaseReason: row.release_reason,
        publishedAt: row.published_at.toISOString(),
        sessionCount: row.bundle && typeof row.bundle === 'object' && row.bundle.sessions && typeof row.bundle.sessions === 'object'
          ? Object.keys(row.bundle.sessions).length
          : 0,
      })),
      drafts: drafts.rows.map(draftResponse),
    } })
  })

  app.post('/v1/admin/content/drafts', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const input = AdminDraftCreateRequestSchema.parse(request.body ?? {})
    const release = input.baseReleaseVersion
      ? await database.pool.query('SELECT release_version, bundle FROM content_releases WHERE release_version = $1', [input.baseReleaseVersion])
      : await database.pool.query('SELECT release_version, bundle FROM content_releases ORDER BY release_version DESC LIMIT 1')
    if (!release.rows[0]) return sendError(reply, 404, 'release_not_found', '没有找到作为草稿基础的发布版本。')
    const created = await database.pool.query(`INSERT INTO content_drafts (base_release_version, bundle)
      VALUES ($1, $2::jsonb) RETURNING *`, [release.rows[0].release_version, JSON.stringify(release.rows[0].bundle)])
    const row = created.rows[0]
    await database.pool.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('content.draft.create', 'draft', $1, $2::jsonb)`, [row.id, JSON.stringify({ baseReleaseVersion: row.base_release_version })])
    return reply.status(201).send({ data: draftResponse(row) })
  })

  app.get('/v1/admin/content/drafts/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const result = await database.pool.query('SELECT * FROM content_drafts WHERE id = $1', [id])
    if (!result.rows[0]) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    return reply.send({ data: draftResponse(result.rows[0]) })
  })

  app.put('/v1/admin/content/drafts/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = AdminDraftUpdateRequestSchema.parse(request.body)
    const result = await database.pool.query(`UPDATE content_drafts SET bundle = $3::jsonb,
      revision = revision + 1, updated_at = now() WHERE id = $1 AND revision = $2 AND status = 'draft' RETURNING *`,
    [id, input.revision, JSON.stringify(input.bundle)])
    if (!result.rows[0]) {
      const existing = await database.pool.query('SELECT status FROM content_drafts WHERE id = $1', [id])
      if (!existing.rows[0]) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
      if (existing.rows[0].status !== 'draft') return sendError(reply, 409, 'draft_not_editable', '已发布草稿不能继续编辑。')
      return sendError(reply, 409, 'draft_conflict', '草稿已在其他位置更新，请重新加载。')
    }
    return reply.send({ data: draftResponse(result.rows[0]) })
  })

  app.post('/v1/admin/content/drafts/:id/validate', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const result = await database.pool.query('SELECT bundle FROM content_drafts WHERE id = $1', [id])
    if (!result.rows[0]) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    const validation = validateContentBundle(result.rows[0].bundle)
    if (!validation.bundle) return reply.send({ data: { valid: false, issues: validation.issues, normalizedBundle: null } })
    const history = await loadReleaseBundles(database)
    const nextVersion = Math.max(0, ...history.map((bundle) => bundle.releaseVersion)) + 1
    const normalizedBundle = normalizeContentBundle(validation.bundle, history, nextVersion)
    return reply.send({ data: { valid: validation.valid, issues: validation.issues, normalizedBundle } })
  })

  app.post('/v1/admin/content/drafts/:id/publish', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = AdminPublishRequestSchema.parse(request.body)
    const result = await publishDraft(database, id, input.revision, input.reason)
    if ('error' in result) {
      if (result.error === 'not_found') return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
      if (result.error === 'conflict') return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
      if (result.error === 'not_editable') return sendError(reply, 409, 'draft_not_editable', '草稿已经发布。')
      return reply.status(422).send({ error: { code: 'content_invalid', message: '内容没有通过发布校验。', issues: result.issues } })
    }
    return reply.status(201).send({ data: result })
  })

  app.post('/v1/admin/content/releases/:version/rollback-draft', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { version } = z.object({ version: z.coerce.number().int().positive() }).parse(request.params)
    const release = await database.pool.query('SELECT bundle FROM content_releases WHERE release_version = $1', [version])
    if (!release.rows[0]) return sendError(reply, 404, 'release_not_found', '历史版本不存在。')
    const created = await database.pool.query(`INSERT INTO content_drafts (base_release_version, bundle)
      VALUES ($1, $2::jsonb) RETURNING *`, [version, JSON.stringify(release.rows[0].bundle)])
    await database.pool.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('content.rollback.prepare', 'draft', $1, $2::jsonb)`, [created.rows[0].id, JSON.stringify({ version })])
    return reply.status(201).send({ data: draftResponse(created.rows[0]) })
  })

  app.post('/v1/admin/content/current/sessions/:sessionId/withdraw', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { sessionId } = z.object({ sessionId: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params)
    const input = AdminWithdrawRequestSchema.parse(request.body)
    const current = await database.pool.query('SELECT release_version, bundle FROM content_releases ORDER BY release_version DESC LIMIT 1')
    const parsed = TrainingContentBundleSchema.safeParse(current.rows[0]?.bundle)
    if (!parsed.success || !parsed.data.sessions[sessionId]) return sendError(reply, 404, 'session_not_found', '当前版本中没有这组训练。')
    if (Object.keys(parsed.data.sessions).length <= 1) return sendError(reply, 409, 'last_session_protected', '不能下架最后一组训练。')
    const bundle = structuredClone(parsed.data)
    delete bundle.sessions[sessionId]
    Object.entries(bundle.catalogs).forEach(([catalogId, catalog]) => {
      catalog.sessionIds = catalog.sessionIds.filter((id) => id !== sessionId)
      if (!catalog.sessionIds.length) {
        delete bundle.catalogs[catalogId]
        bundle.library.catalogIds = bundle.library.catalogIds.filter((id) => id !== catalogId)
      }
    })
    const created = await database.pool.query(`INSERT INTO content_drafts (base_release_version, bundle)
      VALUES ($1, $2::jsonb) RETURNING *`, [current.rows[0].release_version, JSON.stringify(bundle)])
    const published = await publishDraft(database, created.rows[0].id, created.rows[0].revision, input.reason)
    if ('error' in published) throw new Error('Withdraw draft could not be published')
    await database.pool.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, reason, metadata)
      VALUES ('content.session.withdraw', 'session', $1, $2, $3::jsonb)`, [sessionId, input.reason, JSON.stringify({ releaseVersion: published.releaseVersion })])
    return reply.status(201).send({ data: { sessionId, releaseVersion: published.releaseVersion, checksum: published.checksum } })
  })

  app.get('/v1/admin/feedback', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const query = z.object({
      status: AdminFeedbackStatusSchema.optional(),
      category: z.enum(feedbackCategories).optional(),
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(request.query)
    const conditions: string[] = []
    const values: unknown[] = []
    if (query.status) { values.push(query.status); conditions.push(`status = $${values.length}`) }
    if (query.category) { values.push(query.category); conditions.push(`category = $${values.length}`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const count = await database.pool.query(`SELECT count(*)::int AS count FROM feedback ${where}`, values)
    values.push(query.pageSize, (query.page - 1) * query.pageSize)
    const rows = await database.pool.query(`SELECT id, category, detail, session_id, content_version, status,
      internal_note, created_at, updated_at, resolved_at FROM feedback ${where}
      ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
    return reply.send({ data: { items: rows.rows.map((row) => ({
      id: row.id, category: row.category, detail: row.detail, sessionId: row.session_id,
      contentVersion: row.content_version, status: row.status, internalNote: row.internal_note,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), resolvedAt: row.resolved_at?.toISOString() ?? null,
    })), total: count.rows[0].count, page: query.page, pageSize: query.pageSize } })
  })

  app.patch('/v1/admin/feedback/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = AdminFeedbackUpdateRequestSchema.parse(request.body)
    const result = await database.pool.query(`UPDATE feedback SET status = $2::text, internal_note = $3,
      updated_at = now(), resolved_at = CASE WHEN $2::text IN ('resolved', 'dismissed') THEN now() ELSE NULL END
      WHERE id = $1 RETURNING id, category, detail, session_id, content_version, status, internal_note,
      created_at, updated_at, resolved_at`, [id, input.status, input.internalNote ?? null])
    const row = result.rows[0]
    if (!row) return sendError(reply, 404, 'feedback_not_found', '反馈不存在。')
    await database.pool.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('feedback.status.update', 'feedback', $1, $2::jsonb)`, [id, JSON.stringify({ status: input.status })])
    return reply.send({ data: {
      id: row.id, category: row.category, detail: row.detail, sessionId: row.session_id,
      contentVersion: row.content_version, status: row.status, internalNote: row.internal_note,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), resolvedAt: row.resolved_at?.toISOString() ?? null,
    } })
  })

  app.get('/v1/admin/metrics', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { window } = z.object({ window: z.enum(['7d', '30d']).default('7d') }).parse(request.query)
    const days = window === '7d' ? 7 : 30
    const funnel = await database.pool.query(`WITH first_open AS (
        SELECT account_id, min(occurred_at) AS opened_at FROM analytics_events WHERE name = 'app_open' GROUP BY account_id
      ), cohort AS (
        SELECT * FROM first_open WHERE opened_at >= now() - ($1::int * interval '1 day')
      ), ordered AS (
        SELECT c.account_id, c.opened_at,
          o.onboarding_at, s.start_at, x.option_at, f.complete_at, l.login_at
        FROM cohort c
        LEFT JOIN LATERAL (SELECT min(occurred_at) onboarding_at FROM analytics_events WHERE account_id=c.account_id AND name='onboarding_view' AND occurred_at>=c.opened_at) o ON true
        LEFT JOIN LATERAL (SELECT min(occurred_at) start_at FROM analytics_events WHERE account_id=c.account_id AND name='training_start' AND occurred_at>=o.onboarding_at) s ON true
        LEFT JOIN LATERAL (SELECT min(occurred_at) option_at FROM analytics_events WHERE account_id=c.account_id AND name='option_select' AND occurred_at>=s.start_at) x ON true
        LEFT JOIN LATERAL (SELECT min(occurred_at) complete_at FROM analytics_events WHERE account_id=c.account_id AND name='training_complete' AND occurred_at>=x.option_at) f ON true
        LEFT JOIN LATERAL (SELECT min(occurred_at) login_at FROM analytics_events WHERE account_id=c.account_id AND name='wechat_login_success' AND occurred_at>=f.complete_at) l ON true
      ) SELECT count(*)::int app_open, count(onboarding_at)::int onboarding_view,
        count(start_at)::int training_start, count(option_at)::int option_select,
        count(complete_at)::int training_complete, count(login_at)::int wechat_login_success FROM ordered`, [days])
    const counts = funnel.rows[0] ?? {}
    let previous: number | null = null
    const funnelData = funnelNames.map((name) => {
      const accounts = Number(counts[name] ?? 0)
      const conversionRate = previous === null ? null : previous === 0 ? 0 : Math.min(1, accounts / previous)
      previous = accounts
      return { name, accounts, conversionRate }
    })
    const [daily, sessions, feedbackStats] = await Promise.all([
      database.pool.query(`SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') date,
        count(*) FILTER (WHERE name='training_start')::int starts,
        count(*) FILTER (WHERE name='training_complete')::int completions
        FROM analytics_events WHERE occurred_at >= now() - ($1::int * interval '1 day')
        AND name IN ('training_start','training_complete') GROUP BY 1 ORDER BY 1`, [days]),
      database.pool.query(`SELECT properties->>'sessionId' session_id,
        count(*) FILTER (WHERE name='training_start')::int starts,
        count(*) FILTER (WHERE name='training_complete')::int completions
        FROM analytics_events WHERE occurred_at >= now() - ($1::int * interval '1 day')
        AND name IN ('training_start','training_complete') AND properties ? 'sessionId'
        GROUP BY 1 ORDER BY completions DESC, starts DESC LIMIT 10`, [days]),
      database.pool.query(`SELECT status, category, count(*)::int count FROM feedback
        WHERE created_at >= now() - ($1::int * interval '1 day') GROUP BY status, category`, [days]),
    ])
    const byStatus = { new: 0, in_progress: 0, resolved: 0, dismissed: 0 }
    const byCategory: Record<string, number> = {}
    let total = 0
    feedbackStats.rows.forEach((row) => {
      const count = Number(row.count)
      byStatus[row.status as keyof typeof byStatus] += count
      byCategory[row.category] = (byCategory[row.category] ?? 0) + count
      total += count
    })
    return reply.send({ data: {
      window, generatedAt: new Date().toISOString(), funnel: funnelData,
      daily: daily.rows.map((row) => ({ date: row.date, starts: row.starts, completions: row.completions })),
      sessions: sessions.rows.map((row) => ({ sessionId: row.session_id, starts: row.starts, completions: row.completions, completionRate: row.starts ? Math.min(1, row.completions / row.starts) : 0 })),
      feedback: { total, byStatus, byCategory },
    } })
  })

  const serializeAiConfig = (row: Record<string, any>) => ({
    id: row.id,
    provider: row.provider,
    modelId: row.model_id,
    displayName: row.display_name,
    thinkingEnabled: row.thinking_enabled,
    maxTokens: row.max_tokens,
    temperature: row.temperature,
    timeoutMs: row.timeout_ms,
    dailyQuota: row.daily_quota,
    inputCacheHitPrice: row.input_cache_hit_price,
    inputCacheMissPrice: row.input_cache_miss_price,
    outputPrice: row.output_price,
    active: row.active,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  })

  app.get('/v1/admin/ai/config', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const result = await database.pool.query('SELECT * FROM ai_model_configs ORDER BY active DESC, model_id')
    return reply.send({ data: {
      configured: ai?.configured ?? false,
      activeModelId: result.rows.find((row) => row.active)?.model_id ?? null,
      models: result.rows.map(serializeAiConfig),
    } })
  })

  app.post('/v1/admin/ai/models/refresh', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    if (!ai?.provider) return sendError(reply, 503, 'ai_not_configured', '尚未配置 DeepSeek API Key。')
    let models: Array<{ id: string; name?: string }>
    try { models = await ai.provider.listModels() } catch { return sendError(reply, 502, 'ai_provider_unavailable', '暂时无法同步 DeepSeek 模型。') }
    for (const model of models.filter((item) => /^deepseek-[a-z0-9-]+$/.test(item.id))) {
      await database.pool.query(`INSERT INTO ai_model_configs (model_id, display_name)
        VALUES ($1,$2) ON CONFLICT (model_id) DO UPDATE SET display_name=excluded.display_name, updated_at=now()`,
      [model.id, model.name ?? model.id])
    }
    const result = await database.pool.query('SELECT * FROM ai_model_configs ORDER BY active DESC, model_id')
    return reply.send({ data: {
      configured: true,
      activeModelId: result.rows.find((row) => row.active)?.model_id ?? null,
      models: result.rows.map(serializeAiConfig),
    } })
  })

  app.put('/v1/admin/ai/config', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const input = AdminAiConfigUpdateRequestSchema.parse(request.body)
    const client = await database.pool.connect()
    try {
      await client.query('BEGIN')
      const target = await client.query('SELECT * FROM ai_model_configs WHERE model_id=$1 FOR UPDATE', [input.modelId])
      if (!target.rows[0]) { await client.query('ROLLBACK'); return sendError(reply, 404, 'ai_model_not_found', '模型不存在，请先同步模型列表。') }
      if (target.rows[0].revision !== input.revision) { await client.query('ROLLBACK'); return sendError(reply, 409, 'ai_config_conflict', '模型配置已更新，请重新加载。') }
      await client.query('UPDATE ai_model_configs SET active=false WHERE active=true')
      const updated = await client.query(`UPDATE ai_model_configs SET active=true, thinking_enabled=$2,
        max_tokens=$3, temperature=$4, timeout_ms=$5, daily_quota=$6,
        input_cache_hit_price=$7, input_cache_miss_price=$8, output_price=$9,
        revision=revision+1, updated_at=now() WHERE model_id=$1 RETURNING *`,
      [input.modelId, input.thinkingEnabled, input.maxTokens, input.temperature, input.timeoutMs, input.dailyQuota,
        input.inputCacheHitPrice, input.inputCacheMissPrice, input.outputPrice])
      await client.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, reason, metadata)
        VALUES ('ai.model.activate','ai_model',$1,$2,$3::jsonb)`, [input.modelId, input.reason, JSON.stringify({ revision: updated.rows[0].revision })])
      await client.query('COMMIT')
    } catch (cause) {
      await client.query('ROLLBACK')
      throw cause
    } finally { client.release() }
    const result = await database.pool.query('SELECT * FROM ai_model_configs ORDER BY active DESC, model_id')
    return reply.send({ data: { configured: ai?.configured ?? false, activeModelId: input.modelId, models: result.rows.map(serializeAiConfig) } })
  })

  app.get('/v1/admin/ai/metrics', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { window } = z.object({ window: z.enum(['7d', '30d']).default('7d') }).parse(request.query)
    const days = window === '7d' ? 7 : 30
    const [summary, statuses, models, ratings] = await Promise.all([
      database.pool.query(`SELECT count(*)::int total,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) latency_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) latency_p95,
        coalesce(sum(prompt_tokens),0)::int prompt_tokens,
        coalesce(sum(completion_tokens),0)::int completion_tokens,
        coalesce(sum(estimated_cost_usd),0)::float estimated_cost_usd,
        coalesce(sum(format_retries),0)::int format_retries
        FROM ai_evaluations WHERE created_at >= now() - ($1::int * interval '1 day')`, [days]),
      database.pool.query(`SELECT status, count(*)::int count FROM ai_evaluations
        WHERE created_at >= now() - ($1::int * interval '1 day') GROUP BY status`, [days]),
      database.pool.query(`SELECT model_id, count(*)::int count FROM ai_evaluations
        WHERE created_at >= now() - ($1::int * interval '1 day') GROUP BY model_id ORDER BY count DESC`, [days]),
      database.pool.query(`SELECT count(*)::int total, count(*) FILTER (WHERE helpful)::int helpful
        FROM ai_evaluation_ratings WHERE updated_at >= now() - ($1::int * interval '1 day')`, [days]),
    ])
    const row = summary.rows[0]
    const byStatus = { queued: 0, processing: 0, succeeded: 0, degraded: 0, blocked: 0, canceled: 0 }
    statuses.rows.forEach((item) => { byStatus[item.status as keyof typeof byStatus] = Number(item.count) })
    const rating = ratings.rows[0]
    return reply.send({ data: {
      window,
      total: Number(row.total),
      byStatus,
      latencyP50: row.latency_p50 === null ? null : Number(row.latency_p50),
      latencyP95: row.latency_p95 === null ? null : Number(row.latency_p95),
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      estimatedCostUsd: Number(row.estimated_cost_usd),
      formatRetryRate: row.total ? Math.min(1, Number(row.format_retries) / Number(row.total)) : 0,
      helpfulRate: rating.total ? Number(rating.helpful) / Number(rating.total) : null,
      models: models.rows.map((item) => ({ modelId: item.model_id, count: Number(item.count) })),
    } })
  })
}
