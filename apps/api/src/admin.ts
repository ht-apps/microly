import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

import {
  AdminAiConfigUpdateRequestSchema,
  AdminContentReviewUpdateRequestSchema,
  AdminDraftCreateRequestSchema,
  AdminDraftStateRequestSchema,
  AdminDraftUpdateRequestSchema,
  AdminFeedbackStatusSchema,
  AdminFeedbackUpdateRequestSchema,
  AdminClientErrorUpdateRequestSchema,
  ContentQualityIssueUpdateRequestSchema,
  AdminGenerationJobInsertRequestSchema,
  AdminOutlineGenerateRequestSchema,
  AdminPublishRequestSchema,
  AdminReviewVariantGenerateRequestSchema,
  AdminSessionGenerateRequestSchema,
  AdminWithdrawRequestSchema,
  type AdminSessionOutline,
} from '@microly/api-contract'
import { ReviewVariantSchema, TrainingContentBundleSchema, TrainingSessionSchema, type TrainingContentBundle, type TrainingSession } from '@microly/content-schema'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { DatabaseContext } from './db/client.js'
import { checksumBundle } from './db/seed.js'
import { activeConfig, AiProviderValidationError, type AiProvider } from './ai.js'
import type { RuntimeMetrics } from './runtime-metrics.js'
import { buildLearningQuality } from './learning-quality.js'

const feedbackCategories = ['content_error', 'product_suggestion', 'inappropriate_content'] as const
const funnelNames = ['app_open', 'onboarding_view', 'training_start', 'option_select', 'training_complete', 'wechat_login_success'] as const

type AdminOptions = { token: string; origins: string[] }
type ValidationIssue = { path: string; message: string; severity: 'error' | 'warning' }
const highRiskPattern = /(?:法律争议|劳动仲裁|安全事故|自杀|伤害|报警|违法|医疗诊断|公司机密|商业秘密)/u
const unsafePromisePattern = /(?:无条件(?:保证|承诺)|(?:保证|承诺).{0,12}(?:一定|绝对)|你(?:就是|总是|从不).{0,10}(?:不负责|不专业|能力差))/u
const productionTargets: Record<string, number> = {
  'boundary-communication': 8,
  'clear-reporting': 8,
  'constructive-disagreement': 7,
  'action-alignment': 7,
}

function reviewVariantText(value: { title: string; context: string; question: string; prompt: string; options: Array<{ text: string }> }) {
  return [value.title, value.context, value.question, value.prompt, ...value.options.map((option) => option.text)].join(' ')
}

function sessionRiskText(session: TrainingSession) {
  // Feedback applicability and safety reminders intentionally name situations
  // where a lesson must not be used. Scan learner prompts and candidate answers,
  // not those exclusion notices, to avoid false positives.
  const cardText = session.cards.flatMap((card) => {
    if (card.type === 'scenario') return [card.eyebrow, card.title, card.context, card.question]
    if (card.type === 'choice') return [card.prompt, ...card.options.map((option) => option.text)]
    if (card.type === 'feedback') return [card.title, card.comparisonLabel]
    if (card.type === 'principle') return [card.title, card.summary, card.formula, card.counterexample, card.example]
    if (card.type === 'practice') return [card.title, card.prompt, card.referenceAnswer]
    return [card.title, card.summary, card.takeaway]
  })
  return [session.title, session.objective, ...cardText, ...session.reviewVariants.map(reviewVariantText)].join(' ')
}

function sessionDigest(session: TrainingSession) {
  const normalized = structuredClone(session)
  normalized.contentVersion = 1
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function sessionSimilarityText(session: TrainingSession) {
  const scenario = session.cards.find((card) => card.type === 'scenario')
  const principle = session.cards.find((card) => card.type === 'principle')
  return [session.title, session.objective, scenario?.context, scenario?.question, principle?.summary, principle?.formula]
    .filter(Boolean).join('').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function bigrams(value: string) {
  const values = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) values.add(value.slice(index, index + 2))
  return values
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0
  let intersection = 0
  left.forEach((value) => { if (right.has(value)) intersection += 1 })
  return intersection / (left.size + right.size - intersection)
}

function contentSimilarity(left: TrainingSession, right: TrainingSession) {
  const a = bigrams(sessionSimilarityText(left))
  const b = bigrams(sessionSimilarityText(right))
  if (!a.size || !b.size) return 0
  let intersection = 0
  a.forEach((value) => { if (b.has(value)) intersection += 1 })
  return intersection / (a.size + b.size - intersection)
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

function generationFailure(cause: unknown) {
  const name = cause instanceof Error ? cause.name : ''
  const message = cause instanceof Error ? cause.message : ''
  if (name === 'TimeoutError' || name === 'AbortError' || /(?:timeout|aborted)/iu.test(message)) {
    return { status: 504, code: 'ai_generation_timeout', failureCode: 'timeout', message: '复习变体生成超时，请重试或减少生成数量。' }
  }
  if (cause instanceof SyntaxError) {
    return { status: 502, code: 'ai_generation_format_invalid', failureCode: 'invalid_json', message: '模型返回内容不完整，请重试。' }
  }
  if (cause instanceof AiProviderValidationError) {
    const paths = [...new Set(cause.issuePaths)].slice(0, 5).join('、')
    const safePath = [...new Set(cause.issuePaths)].slice(0, 2).join(',').replace(/[^a-zA-Z0-9_.[\],-]/gu, '').slice(0, 62)
    return {
      status: 502,
      code: 'ai_generation_format_invalid',
      failureCode: safePath ? `invalid_schema:${safePath}` : 'invalid_schema',
      message: `模型返回字段未通过校验：${paths}。`,
    }
  }
  if (cause instanceof z.ZodError) {
    const safePath = cause.issues.slice(0, 2).map((issue) => issue.path.map(String).join('.') || 'root')
      .join(',').replace(/[^a-zA-Z0-9_.[\],-]/gu, '').slice(0, 62)
    return {
      status: 502,
      code: 'ai_generation_format_invalid',
      failureCode: safePath ? `invalid_schema:${safePath}` : 'invalid_schema',
      message: '模型返回内容未通过格式校验，请重试。',
    }
  }
  if (/(?:invalid_(?:review_variants|output|dimensions)|deepseek_empty_output)/u.test(message)) {
    return { status: 502, code: 'ai_generation_format_invalid', failureCode: 'invalid_schema', message: '模型返回内容未通过格式校验，请重试。' }
  }
  if (message === 'high_risk_candidate') {
    return { status: 422, code: 'ai_generation_content_rejected', failureCode: 'high_risk', message: '候选内容未通过安全校验，请重新生成。' }
  }
  return { status: 502, code: 'ai_generation_failed', failureCode: 'provider_failed', message: '复习变体生成失败，请稍后重试。' }
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
    if (!session.reviewVariants.length) warnings.push({ path: `sessions.${sessionId}.reviewVariants`, message: '尚未配置复习变体，将回退使用原题。', severity: 'warning' })
    if (choice) {
      const texts = new Set<string>()
      choice.options.forEach((option, index) => {
        if (texts.has(option.text)) warnings.push({ path: `sessions.${sessionId}.cards.1.options.${index}.text`, message: '选项文本重复。', severity: 'warning' })
        texts.add(option.text)
      })
      session.reviewVariants.forEach((variant, variantIndex) => {
        if (variant.title === session.title) warnings.push({ path: `sessions.${sessionId}.reviewVariants.${variantIndex}.title`, message: '复习变体标题与原训练相同。', severity: 'warning' })
        variant.options.forEach((option, optionIndex) => {
          if (choice.options.some((source) => source.text === option.text)) warnings.push({ path: `sessions.${sessionId}.reviewVariants.${variantIndex}.options.${optionIndex}.text`, message: '变体选项与原题选项重复。', severity: 'warning' })
        })
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
    if (highRiskPattern.test(sessionRiskText(session))) issues.push({ path: `sessions.${id}`, message: '训练包含当前版本不允许发布的高风险内容。', severity: 'error' })
    if (unsafePromisePattern.test(sessionRiskText(session))) issues.push({ path: `sessions.${id}`, message: '训练包含绝对化承诺或人格评价。', severity: 'error' })
    const principle = session.cards.find((card) => card.type === 'principle')
    const practice = session.cards.find((card) => card.type === 'practice')
    const objectiveBigrams = bigrams(session.objective)
    const principleBigrams = bigrams(`${principle?.summary ?? ''}${principle?.formula ?? ''}`)
    const practiceBigrams = bigrams((practice?.dimensions ?? []).map((dimension) => `${dimension.title}${dimension.description}`).join(''))
    if (objectiveBigrams.size && principleBigrams.size && jaccard(objectiveBigrams, principleBigrams) < 0.02) {
      issues.push({ path: `sessions.${id}.cards`, message: '原则与训练目标的文本关联较弱，请人工确认一致性。', severity: 'warning' })
    }
    if (objectiveBigrams.size && practiceBigrams.size && jaccard(objectiveBigrams, practiceBigrams) < 0.01) {
      issues.push({ path: `sessions.${id}.cards`, message: '主动表达维度与训练目标的文本关联较弱，请人工确认。', severity: 'warning' })
    }
    session.reviewVariants.forEach((variant, index) => {
      if (highRiskPattern.test(reviewVariantText(variant))) issues.push({ path: `sessions.${id}.reviewVariants.${index}`, message: '复习变体包含当前版本不允许发布的高风险内容。', severity: 'error' })
    })
  })
  const sessions = Object.entries(parsed.data.sessions)
  for (let left = 0; left < sessions.length; left += 1) {
    for (let right = left + 1; right < sessions.length; right += 1) {
      const [leftId, leftSession] = sessions[left]!
      const [rightId, rightSession] = sessions[right]!
      const similarity = contentSimilarity(leftSession, rightSession)
      if (similarity >= 0.9) issues.push({ path: `sessions.${rightId}`, message: `训练与 ${leftId} 高度重复（${similarity.toFixed(2)}）。`, severity: 'error' })
      else if (similarity >= 0.75) issues.push({ path: `sessions.${rightId}`, message: `训练与 ${leftId} 较为相似（${similarity.toFixed(2)}），请人工确认。`, severity: 'warning' })
    }
  }
  Object.entries(parsed.data.catalogs).forEach(([catalogId, catalog]) => {
    const positions = catalog.sessionIds.flatMap((sessionId) => {
      const choice = parsed.data.sessions[sessionId]?.cards.find((card) => card.type === 'choice')
      const index = choice?.options.findIndex((option) => option.rating === 'recommended') ?? -1
      return index >= 0 ? [index] : []
    })
    if (positions.length >= 5 && positions.filter((position) => position === positions[0]).length / positions.length > 0.6) {
      issues.push({ path: `catalogs.${catalogId}.sessionIds`, message: '推荐选项位置过于集中，可能泄露答案规律。', severity: 'warning' })
    }
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

function generationJobResponse(row: Record<string, any>) {
  const result = row.result && typeof row.result === 'object' ? row.result : {}
  const input = row.input && typeof row.input === 'object' ? row.input : {}
  return {
    id: row.id,
    requestId: row.request_id,
    draftId: row.draft_id,
    catalogId: row.catalog_id,
    draftRevision: row.draft_revision,
    operation: row.operation,
    status: row.status,
    requestedCount: row.requested_count,
    parameters: {
      difficulties: Array.isArray(input.difficulties) ? input.difficulties : [],
      brief: typeof input.brief === 'string' ? input.brief : null,
      outlineJobId: typeof input.outlineJobId === 'string' ? input.outlineJobId : null,
      outlineIds: Array.isArray(input.outlineIds) ? input.outlineIds : [],
    },
    outlines: Array.isArray(result.outlines) ? result.outlines : [],
    candidates: Array.isArray(result.candidates) ? result.candidates : [],
    insertedCandidateIds: Array.isArray(row.inserted_candidate_ids) ? row.inserted_candidate_ids : [],
    model: row.model_id && row.config_revision && row.prompt_version
      ? { modelId: row.model_id, configRevision: row.config_revision, promptVersion: row.prompt_version }
      : null,
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    formatRetries: Number(row.format_retries ?? 0),
    failureCode: row.failure_code,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
  }
}

function generatedContentCost(usage: { cacheHitTokens: number; cacheMissTokens: number; completionTokens: number }, config: Awaited<ReturnType<typeof activeConfig>>) {
  if (!config) return 0
  return ((usage.cacheHitTokens * config.inputCacheHitPrice) + (usage.cacheMissTokens * config.inputCacheMissPrice) + (usage.completionTokens * config.outputPrice)) / 1_000_000
}

function uniqueGeneratedSessionId(value: string, used: Set<string>) {
  const base = value.toLocaleLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'generated-session'
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base.slice(0, 75)}-${suffix++}`
  used.add(candidate)
  return candidate
}

async function loadReleaseBundles(database: DatabaseContext) {
  const rows = await database.pool.query('SELECT bundle FROM content_releases ORDER BY release_version DESC')
  return rows.rows.flatMap(({ bundle }) => {
    const parsed = TrainingContentBundleSchema.safeParse(bundle)
    return parsed.success ? [parsed.data] : []
  })
}

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> }

async function draftReadiness(queryable: Queryable, draft: Record<string, any>) {
  const parsed = TrainingContentBundleSchema.safeParse(draft.bundle)
  if (!parsed.success) {
    const validation = validateContentBundle(draft.bundle)
    return {
      bundle: null, changedSessions: [] as string[], unreviewedSessions: [] as string[], reviews: [] as any[],
      data: {
        totalSessions: 0, targetSessions: 30 as const, targetMet: false, catalogs: [],
        difficulty: { L1: 0, L2: 0, L3: 0, L4: 0 }, missingVariants: [], changedSessions: [], unreviewedSessions: [], sessionDigests: {},
        blockingIssues: validation.issues.filter((issue) => issue.severity === 'error'),
        warnings: validation.issues.filter((issue) => issue.severity === 'warning'),
      },
    }
  }
  const bundle = parsed.data
  const baseResult = draft.base_release_version
    ? await queryable.query('SELECT bundle FROM content_releases WHERE release_version=$1', [draft.base_release_version])
    : { rows: [] }
  const base = TrainingContentBundleSchema.safeParse(baseResult.rows[0]?.bundle)
  const changedSessions = Object.entries(bundle.sessions).flatMap(([sessionId, session]) => {
    const previous = base.success ? base.data.sessions[sessionId] : undefined
    return !previous || sessionDigest(previous) !== sessionDigest(session) ? [sessionId] : []
  })
  const reviewRows = await queryable.query('SELECT * FROM content_session_reviews WHERE draft_id=$1', [draft.id])
  const bySession = new Map(reviewRows.rows.map((row) => [row.session_id as string, row]))
  const unreviewedSessions = changedSessions.filter((sessionId) => {
    const session = bundle.sessions[sessionId]!
    const row = bySession.get(sessionId)
    if (!row || row.content_digest !== sessionDigest(session)) return true
    return session.riskLevel === 'medium'
      && (!row.reviewer_label || row.reviewer_label.trim() === row.operator_label.trim())
  })
  const validation = validateContentBundle(bundle)
  const reviewIssues: ValidationIssue[] = unreviewedSessions.map((sessionId) => ({
    path: `sessions.${sessionId}`, message: '新增或修改的训练尚未完成当前内容版本审核。', severity: 'error',
  }))
  const difficulty = { L1: 0, L2: 0, L3: 0, L4: 0 }
  Object.values(bundle.sessions).forEach((session) => { difficulty[session.difficulty] += 1 })
  const catalogs = bundle.library.catalogIds.flatMap((catalogId) => {
    const catalog = bundle.catalogs[catalogId]
    return catalog ? [{ catalogId, title: catalog.title, count: catalog.sessionIds.length, target: productionTargets[catalogId] ?? catalog.sessionIds.length }] : []
  })
  const reviews = reviewRows.rows.flatMap((row) => {
    const session = bundle.sessions[row.session_id]
    if (!session) return []
    const currentDigest = sessionDigest(session)
    return [{
      sessionId: row.session_id, contentDigest: row.content_digest, currentDigest,
      current: row.content_digest === currentDigest, riskLevel: session.riskLevel,
      checklist: row.checklist, operatorLabel: row.operator_label, reviewerLabel: row.reviewer_label,
      note: row.note, reviewedAt: row.reviewed_at.toISOString(),
    }]
  })
  const allIssues = [...validation.issues, ...reviewIssues]
  return {
    bundle, changedSessions, unreviewedSessions, reviews,
    data: {
      totalSessions: Object.keys(bundle.sessions).length, targetSessions: 30 as const,
      targetMet: Object.keys(bundle.sessions).length >= 30 && catalogs.every((catalog) => catalog.count >= catalog.target),
      catalogs, difficulty,
      missingVariants: Object.entries(bundle.sessions).filter(([, session]) => session.reviewVariants.length < 2).map(([sessionId]) => sessionId),
      changedSessions, unreviewedSessions,
      sessionDigests: Object.fromEntries(changedSessions.map((sessionId) => [sessionId, sessionDigest(bundle.sessions[sessionId]!)])),
      blockingIssues: allIssues.filter((issue) => issue.severity === 'error'),
      warnings: allIssues.filter((issue) => issue.severity === 'warning'),
    },
  }
}

async function deleteDraft(database: DatabaseContext, id: string, revision: number) {
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT revision, status FROM content_drafts WHERE id = $1 FOR UPDATE', [id])
    if (!current.rows[0]) { await client.query('ROLLBACK'); return { error: 'not_found' as const } }
    if (current.rows[0].revision !== revision) { await client.query('ROLLBACK'); return { error: 'conflict' as const } }
    if (current.rows[0].status !== 'draft') { await client.query('ROLLBACK'); return { error: 'invalid_state' as const } }
    await client.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('content.draft.delete', 'draft', $1, $2::jsonb)`, [id, JSON.stringify({ revision })])
    await client.query('DELETE FROM content_drafts WHERE id = $1', [id])
    await client.query('COMMIT')
    return { id }
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally {
    client.release()
  }
}

async function restoreDraftBase(database: DatabaseContext, id: string, revision: number) {
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT * FROM content_drafts WHERE id = $1 FOR UPDATE', [id])
    const draft = current.rows[0]
    if (!draft) { await client.query('ROLLBACK'); return { error: 'not_found' as const } }
    if (draft.revision !== revision) { await client.query('ROLLBACK'); return { error: 'conflict' as const } }
    if (draft.status !== 'draft') { await client.query('ROLLBACK'); return { error: 'invalid_state' as const } }
    const release = await client.query('SELECT bundle FROM content_releases WHERE release_version = $1', [draft.base_release_version])
    if (!release.rows[0]) { await client.query('ROLLBACK'); return { error: 'release_not_found' as const } }
    const restored = await client.query(`UPDATE content_drafts SET bundle = $2::jsonb,
      revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, JSON.stringify(release.rows[0].bundle)])
    await client.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('content.draft.restore', 'draft', $1, $2::jsonb)`, [id, JSON.stringify({ baseReleaseVersion: draft.base_release_version })])
    await client.query('COMMIT')
    return { draft: restored.rows[0] as Record<string, unknown> }
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally {
    client.release()
  }
}

async function publishDraft(database: DatabaseContext, draftId: string, revision: number, reason: string) {
  const client = await database.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(706042)')
    const draftResult = await client.query('SELECT * FROM content_drafts WHERE id = $1 FOR UPDATE', [draftId])
    const draft = draftResult.rows[0]
    if (!draft) { await client.query('ROLLBACK'); return { error: 'not_found' as const } }
    if (draft.status === 'published' && draft.published_release_version && draft.revision === revision + 1) {
      const existing = await client.query('SELECT release_version, checksum, bundle FROM content_releases WHERE release_version = $1', [draft.published_release_version])
      if (existing.rows[0]) {
        await client.query('ROLLBACK')
        return {
          releaseVersion: existing.rows[0].release_version as number,
          checksum: existing.rows[0].checksum as string,
          bundle: existing.rows[0].bundle as TrainingContentBundle,
          alreadyPublished: true,
        }
      }
    }
    if (draft.status !== 'draft') { await client.query('ROLLBACK'); return { error: 'not_editable' as const } }
    if (draft.revision !== revision) { await client.query('ROLLBACK'); return { error: 'conflict' as const } }
    const readiness = await draftReadiness(client as unknown as Queryable, draft)
    if (readiness.unreviewedSessions.length) {
      await client.query('ROLLBACK')
      return { error: 'review_required' as const, sessionIds: readiness.unreviewedSessions }
    }
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
    return { releaseVersion: nextVersion, checksum, bundle, alreadyPublished: false }
  } catch (cause) {
    await client.query('ROLLBACK')
    throw cause
  } finally {
    client.release()
  }
}

export function registerAdminRoutes(app: FastifyInstance, database: DatabaseContext, admin?: AdminOptions, ai?: { provider?: AiProvider; configured: boolean; runtimeMetrics?: RuntimeMetrics }) {
  const generationControllers = new Map<string, AbortController>()
  const generationQueue: Array<{ jobId: string; run: (signal: AbortSignal) => Promise<void> }> = []
  let activeGenerationJobs = 0
  const drainGenerationQueue = () => {
    while (activeGenerationJobs < 2 && generationQueue.length) {
      const item = generationQueue.shift()!
      const controller = new AbortController()
      generationControllers.set(item.jobId, controller)
      activeGenerationJobs += 1
      void item.run(controller.signal).catch(() => undefined).finally(() => {
        generationControllers.delete(item.jobId)
        activeGenerationJobs -= 1
        drainGenerationQueue()
      })
    }
  }
  const scheduleGeneration = (jobId: string, run: (signal: AbortSignal) => Promise<void>) => {
    generationQueue.push({ jobId, run })
    drainGenerationQueue()
  }

  app.addHook('onReady', async () => {
    await database.pool.query(`UPDATE admin_content_generation_jobs SET status='failed', failure_code='process_restarted',
      completed_at=now(), updated_at=now() WHERE status IN ('queued','processing')`)
  })

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (admin && origin && admin.origins.includes(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
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

  app.get('/v1/admin/content/releases/:version', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { version } = z.object({ version: z.coerce.number().int().positive() }).parse(request.params)
    const result = await database.pool.query(`SELECT release_version, checksum, created_from_version,
      release_reason, published_at, bundle FROM content_releases WHERE release_version = $1`, [version])
    const row = result.rows[0]
    if (!row) return sendError(reply, 404, 'release_not_found', '发布版本不存在。')
    const bundle = TrainingContentBundleSchema.safeParse(row.bundle)
    if (!bundle.success) return sendError(reply, 500, 'release_invalid', '历史发布内容无法读取。')
    return reply.send({ data: {
      releaseVersion: row.release_version,
      checksum: row.checksum,
      createdFromVersion: row.created_from_version,
      releaseReason: row.release_reason,
      publishedAt: row.published_at.toISOString(),
      sessionCount: Object.keys(bundle.data.sessions).length,
      bundle: bundle.data,
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

  app.delete('/v1/admin/content/drafts/:id', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = AdminDraftStateRequestSchema.parse(request.body)
    const result = await deleteDraft(database, id, input.revision)
    if ('error' in result) {
      if (result.error === 'not_found') return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
      if (result.error === 'conflict') return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
      return sendError(reply, 409, 'draft_not_deletable', '只有未发布草稿可以删除。')
    }
    return reply.send({ data: { id: result.id } })
  })

  app.post('/v1/admin/content/drafts/:id/restore', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = AdminDraftStateRequestSchema.parse(request.body)
    const result = await restoreDraftBase(database, id, input.revision)
    if ('error' in result) {
      if (result.error === 'not_found') return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
      if (result.error === 'conflict') return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
      if (result.error === 'release_not_found') return sendError(reply, 409, 'draft_base_not_found', '草稿的基础发布版本不存在。')
      return sendError(reply, 409, 'draft_not_restorable', '只有未发布草稿可以恢复到基础版本。')
    }
    return reply.send({ data: draftResponse(result.draft) })
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

  app.post('/v1/admin/content/drafts/:id/sessions/:sessionId/review-variants/generate', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id, sessionId } = z.object({ id: z.uuid(), sessionId: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params)
    const input = AdminReviewVariantGenerateRequestSchema.parse(request.body)
    if (!ai?.provider?.generateReviewVariants) return sendError(reply, 503, 'ai_not_configured', '尚未配置可用的 DeepSeek 内容生成服务。')
    const draftResult = await database.pool.query('SELECT revision, status, bundle FROM content_drafts WHERE id=$1', [id])
    const draft = draftResult.rows[0]
    if (!draft) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    if (draft.status !== 'draft') return sendError(reply, 409, 'draft_not_editable', '已发布草稿不能生成候选。')
    if (draft.revision !== input.revision) return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
    const bundle = TrainingContentBundleSchema.safeParse(draft.bundle)
    const session = bundle.success ? bundle.data.sessions[sessionId] : null
    if (!session) return sendError(reply, 422, 'invalid_content_reference', '请先修正草稿并选择有效训练。')
    const config = await activeConfig(database)
    if (!config) return sendError(reply, 503, 'ai_not_configured', '尚未启用 DeepSeek 模型。')
    const started = Date.now()
    try {
      // Each candidate is generated and validated independently in parallel. A
      // complete candidate still needs more output room than an AI evaluation.
      const generationConfig = { ...config, maxTokens: Math.max(config.maxTokens, 1200) }
      const generated = await ai.provider.generateReviewVariants({ session, count: input.count, config: generationConfig, signal: AbortSignal.timeout(config.timeoutMs) })
      const candidates = z.object({ candidates: z.array(ReviewVariantSchema).length(input.count) }).parse(generated.value).candidates
      if (candidates.some((candidate) => highRiskPattern.test(reviewVariantText(candidate)))) throw new Error('high_risk_candidate')
      const originalChoice = session.cards.find((card) => card.type === 'choice')
      const warnings = candidates.flatMap((candidate) => originalChoice?.options.some((option) => candidate.options.some((item) => item.text === option.text)) ? [`${candidate.variantId} 包含与原题相同的选项文本。`] : [])
      const usage = generated.usage
      const cost = ((usage.cacheHitTokens * config.inputCacheHitPrice) + (usage.cacheMissTokens * config.inputCacheMissPrice) + (usage.completionTokens * config.outputPrice)) / 1_000_000
      await database.pool.query(`INSERT INTO admin_ai_generation_runs
        (operation,target_id,model_id,config_revision,prompt_version,status,prompt_tokens,completion_tokens,estimated_cost_usd,latency_ms,format_retries)
        VALUES ('review_variants',$1,$2,$3,'review-variant-v1','succeeded',$4,$5,$6,$7,$8)`,
      [sessionId, generated.modelId, config.revision, usage.promptTokens, usage.completionTokens, cost, Date.now() - started, generated.formatRetries])
      return reply.send({ data: { candidates, model: { modelId: generated.modelId, configRevision: config.revision, promptVersion: 'review-variant-v1' }, warnings } })
    } catch (cause) {
      const failure = generationFailure(cause)
      await database.pool.query(`INSERT INTO admin_ai_generation_runs
        (operation,target_id,model_id,config_revision,prompt_version,status,latency_ms,failure_code)
        VALUES ('review_variants',$1,$2,$3,'review-variant-v1','failed',$4,$5)`,
      [sessionId, config.modelId, config.revision, Date.now() - started, failure.failureCode])
      return sendError(reply, failure.status, failure.code, failure.message)
    }
  })

  app.post('/v1/admin/content/drafts/:id/catalogs/:catalogId/session-outlines/generate', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id, catalogId } = z.object({ id: z.uuid(), catalogId: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params)
    const input = AdminOutlineGenerateRequestSchema.parse(request.body)
    if (!ai?.provider?.generateSessionOutlines) return sendError(reply, 503, 'ai_not_configured', '尚未配置完整训练生成服务。')
    const duplicate = await database.pool.query('SELECT * FROM admin_content_generation_jobs WHERE request_id=$1', [input.requestId])
    if (duplicate.rows[0]) return reply.send({ data: generationJobResponse(duplicate.rows[0]) })
    const draftResult = await database.pool.query('SELECT * FROM content_drafts WHERE id=$1', [id])
    const draft = draftResult.rows[0]
    if (!draft) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    if (draft.status !== 'draft') return sendError(reply, 409, 'draft_not_editable', '已发布草稿不能生成候选。')
    if (draft.revision !== input.revision) return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
    const bundle = TrainingContentBundleSchema.safeParse(draft.bundle)
    const catalog = bundle.success ? bundle.data.catalogs[catalogId] : undefined
    if (!bundle.success || !catalog || !bundle.data.library.catalogIds.includes(catalogId)) return sendError(reply, 422, 'invalid_content_reference', '请选择草稿中的有效章节。')
    if (input.difficulties.some((difficulty) => !['L1', 'L2', 'L3'].includes(difficulty))) return sendError(reply, 422, 'invalid_generation_difficulty', '封测内容只能生成 L1 至 L3。')
    const config = await activeConfig(database)
    if (!config) return sendError(reply, 503, 'ai_not_configured', '尚未启用 DeepSeek 模型。')
    const created = await database.pool.query(`INSERT INTO admin_content_generation_jobs
      (request_id,draft_id,catalog_id,draft_revision,operation,status,requested_count,input,model_id,config_revision,prompt_version)
      VALUES ($1,$2,$3,$4,'session_outlines','queued',$5,$6::jsonb,$7,$8,'session-outline-v1') RETURNING *`,
    [input.requestId, id, catalogId, input.revision, input.count, JSON.stringify({ difficulties: input.difficulties, brief: input.brief }), config.modelId, config.revision])
    const job = created.rows[0]
    scheduleGeneration(job.id, async (signal) => {
      const started = Date.now()
      await database.pool.query(`UPDATE admin_content_generation_jobs SET status='processing',started_at=now(),updated_at=now() WHERE id=$1 AND status='queued'`, [job.id])
      try {
        const current = await database.pool.query('SELECT bundle FROM content_drafts WHERE id=$1', [id])
        const currentBundle = TrainingContentBundleSchema.parse(current.rows[0].bundle)
        const generated = await ai.provider!.generateSessionOutlines!({
          catalog: { catalogId, title: catalog.title, skill: catalog.skill, description: catalog.description },
          existingSessions: catalog.sessionIds.map((sessionId) => currentBundle.sessions[sessionId]).filter(Boolean).map((session) => ({ title: session!.title, objective: session!.objective, difficulty: session!.difficulty })),
          count: input.count, difficulties: input.difficulties, brief: input.brief, config,
          signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
        })
        const outlines = z.array(z.object({
          outlineId: z.uuid(), title: z.string(), objective: z.string(), difficulty: z.enum(['L1', 'L2', 'L3']),
          riskLevel: z.enum(['low', 'medium']), scenarioAngle: z.string(), reviewFocus: z.string(),
        }).strict()).length(input.count).parse((generated.value as { outlines?: unknown }).outlines)
        if (outlines.filter((outline) => outline.riskLevel === 'medium').length > 1) throw new Error('too_many_medium_risk_outlines')
        const cost = generatedContentCost(generated.usage, config)
        await database.pool.query(`UPDATE admin_content_generation_jobs SET status='succeeded',result=$2::jsonb,
          model_id=$3,prompt_tokens=$4,completion_tokens=$5,estimated_cost_usd=$6,latency_ms=$7,format_retries=$8,
          completed_at=now(),updated_at=now() WHERE id=$1 AND status='processing'`,
        [job.id, JSON.stringify({ outlines }), generated.modelId, generated.usage.promptTokens, generated.usage.completionTokens, cost, Date.now() - started, generated.formatRetries])
        await database.pool.query(`INSERT INTO admin_ai_generation_runs
          (operation,target_id,model_id,config_revision,prompt_version,status,prompt_tokens,completion_tokens,estimated_cost_usd,latency_ms,format_retries)
          VALUES ('session_outlines',$1,$2,$3,'session-outline-v1','succeeded',$4,$5,$6,$7,$8)`,
        [catalogId, generated.modelId, config.revision, generated.usage.promptTokens, generated.usage.completionTokens, cost, Date.now() - started, generated.formatRetries])
      } catch (cause) {
        const canceled = signal.aborted
        const failure = generationFailure(cause)
        await database.pool.query(`UPDATE admin_content_generation_jobs SET status=$2,failure_code=$3,latency_ms=$4,
          completed_at=now(),updated_at=now() WHERE id=$1 AND status IN ('queued','processing')`,
        [job.id, canceled ? 'canceled' : 'failed', canceled ? 'canceled' : failure.failureCode, Date.now() - started])
        await database.pool.query(`INSERT INTO admin_ai_generation_runs
          (operation,target_id,model_id,config_revision,prompt_version,status,latency_ms,failure_code)
          VALUES ('session_outlines',$1,$2,$3,'session-outline-v1','failed',$4,$5)`,
        [catalogId, config.modelId, config.revision, Date.now() - started, canceled ? 'canceled' : failure.failureCode])
      }
    })
    return reply.status(202).send({ data: generationJobResponse(job) })
  })

  app.post('/v1/admin/content/drafts/:id/sessions/generate', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const input = AdminSessionGenerateRequestSchema.parse(request.body)
    if (!ai?.provider?.generateTrainingSessions) return sendError(reply, 503, 'ai_not_configured', '尚未配置完整训练生成服务。')
    const duplicate = await database.pool.query('SELECT * FROM admin_content_generation_jobs WHERE request_id=$1', [input.requestId])
    if (duplicate.rows[0]) return reply.send({ data: generationJobResponse(duplicate.rows[0]) })
    const [draftResult, outlineResult] = await Promise.all([
      database.pool.query('SELECT * FROM content_drafts WHERE id=$1', [id]),
      database.pool.query(`SELECT * FROM admin_content_generation_jobs WHERE id=$1 AND draft_id=$2 AND operation='session_outlines'`, [input.outlineJobId, id]),
    ])
    const draft = draftResult.rows[0]
    const outlineJob = outlineResult.rows[0]
    if (!draft) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    if (draft.status !== 'draft') return sendError(reply, 409, 'draft_not_editable', '已发布草稿不能生成候选。')
    if (draft.revision !== input.revision) return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
    if (!outlineJob || outlineJob.status !== 'succeeded' || outlineJob.draft_revision !== input.revision) return sendError(reply, 409, 'generation_job_stale', '大纲任务不存在、未完成或已经过期。')
    const sourceOutlines = ((outlineJob.result?.outlines ?? []) as AdminSessionOutline[]).filter((outline) => input.outlineIds.includes(outline.outlineId))
    const outlines = input.outlines ?? sourceOutlines
    if (sourceOutlines.length !== input.outlineIds.length || outlines.length !== input.outlineIds.length) return sendError(reply, 422, 'invalid_outline_selection', '选择的大纲不存在。')
    const bundle = TrainingContentBundleSchema.safeParse(draft.bundle)
    const catalog = bundle.success ? bundle.data.catalogs[outlineJob.catalog_id] : undefined
    if (!bundle.success || !catalog) return sendError(reply, 422, 'invalid_content_reference', '草稿章节已不存在。')
    const config = await activeConfig(database)
    if (!config) return sendError(reply, 503, 'ai_not_configured', '尚未启用 DeepSeek 模型。')
    const created = await database.pool.query(`INSERT INTO admin_content_generation_jobs
      (request_id,draft_id,catalog_id,draft_revision,operation,status,requested_count,input,model_id,config_revision,prompt_version)
      VALUES ($1,$2,$3,$4,'training_sessions','queued',$5,$6::jsonb,$7,$8,'training-session-v1') RETURNING *`,
    [input.requestId, id, outlineJob.catalog_id, input.revision, outlines.length, JSON.stringify({ outlineJobId: input.outlineJobId, outlineIds: input.outlineIds, outlines, reviewVariantCount: 2 }), config.modelId, config.revision])
    const job = created.rows[0]
    scheduleGeneration(job.id, async (signal) => {
      const started = Date.now()
      await database.pool.query(`UPDATE admin_content_generation_jobs SET status='processing',started_at=now(),updated_at=now() WHERE id=$1 AND status='queued'`, [job.id])
      try {
        const generated = await ai.provider!.generateTrainingSessions!({
          catalog: { catalogId: outlineJob.catalog_id, title: catalog.title, skill: catalog.skill, description: catalog.description },
          outlines,
          existingSessions: catalog.sessionIds.map((sessionId) => bundle.data.sessions[sessionId]).filter(Boolean).map((session) => ({ title: session!.title, objective: session!.objective })),
          reviewVariantCount: 2, config,
          // Each session is generated in two phases: six-card core, then review
          // variants. Keep a bounded per-outline budget without timing out the
          // whole asynchronous batch midway through valid work.
          signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs * outlines.length * 2)]),
        })
        const sessions = z.array(TrainingSessionSchema).length(outlines.length).parse((generated.value as { sessions?: unknown }).sessions)
        const used = new Set(Object.keys(bundle.data.sessions))
        const candidates = sessions.map((source) => {
          const session = structuredClone(source)
          const previousId = session.sessionId
          session.sessionId = uniqueGeneratedSessionId(session.sessionId, used)
          if (session.sessionId !== previousId) {
            session.reviewVariants = session.reviewVariants.map((variant, index) => ({ ...variant, variantId: `${session.sessionId}-review-${index + 1}` }))
          }
          session.contentVersion = 1
          return { candidateId: randomUUID(), session: TrainingSessionSchema.parse(session) }
        })
        const comparison = [...Object.values(bundle.data.sessions)]
        for (const candidate of candidates) {
          if (highRiskPattern.test(sessionRiskText(candidate.session)) || unsafePromisePattern.test(sessionRiskText(candidate.session))) throw new Error('high_risk_candidate')
          if (comparison.some((existing) => contentSimilarity(existing, candidate.session) >= 0.9)) throw new Error('high_similarity_candidate')
          comparison.push(candidate.session)
        }
        const cost = generatedContentCost(generated.usage, config)
        await database.pool.query(`UPDATE admin_content_generation_jobs SET status='succeeded',result=$2::jsonb,
          model_id=$3,prompt_tokens=$4,completion_tokens=$5,estimated_cost_usd=$6,latency_ms=$7,format_retries=$8,
          completed_at=now(),updated_at=now() WHERE id=$1 AND status='processing'`,
        [job.id, JSON.stringify({ candidates }), generated.modelId, generated.usage.promptTokens, generated.usage.completionTokens, cost, Date.now() - started, generated.formatRetries])
        await database.pool.query(`INSERT INTO admin_ai_generation_runs
          (operation,target_id,model_id,config_revision,prompt_version,status,prompt_tokens,completion_tokens,estimated_cost_usd,latency_ms,format_retries)
          VALUES ('training_sessions',$1,$2,$3,'training-session-v1','succeeded',$4,$5,$6,$7,$8)`,
        [outlineJob.catalog_id, generated.modelId, config.revision, generated.usage.promptTokens, generated.usage.completionTokens, cost, Date.now() - started, generated.formatRetries])
      } catch (cause) {
        const canceled = signal.aborted
        const failure = generationFailure(cause)
        await database.pool.query(`UPDATE admin_content_generation_jobs SET status=$2,failure_code=$3,latency_ms=$4,
          completed_at=now(),updated_at=now() WHERE id=$1 AND status IN ('queued','processing')`,
        [job.id, canceled ? 'canceled' : 'failed', canceled ? 'canceled' : failure.failureCode, Date.now() - started])
        await database.pool.query(`INSERT INTO admin_ai_generation_runs
          (operation,target_id,model_id,config_revision,prompt_version,status,latency_ms,failure_code)
          VALUES ('training_sessions',$1,$2,$3,'training-session-v1','failed',$4,$5)`,
        [outlineJob.catalog_id, config.modelId, config.revision, Date.now() - started, canceled ? 'canceled' : failure.failureCode])
      }
    })
    return reply.status(202).send({ data: generationJobResponse(job) })
  })

  app.get('/v1/admin/content/generation-jobs', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { draftId } = z.object({ draftId: z.uuid() }).parse(request.query)
    const result = await database.pool.query('SELECT * FROM admin_content_generation_jobs WHERE draft_id=$1 ORDER BY created_at DESC LIMIT 100', [draftId])
    return reply.send({ data: { items: result.rows.map(generationJobResponse) } })
  })

  app.get('/v1/admin/content/generation-jobs/:jobId', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { jobId } = z.object({ jobId: z.uuid() }).parse(request.params)
    const result = await database.pool.query('SELECT * FROM admin_content_generation_jobs WHERE id=$1', [jobId])
    if (!result.rows[0]) return sendError(reply, 404, 'generation_job_not_found', '内容生成任务不存在。')
    return reply.send({ data: generationJobResponse(result.rows[0]) })
  })

  app.post('/v1/admin/content/generation-jobs/:jobId/cancel', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { jobId } = z.object({ jobId: z.uuid() }).parse(request.params)
    generationControllers.get(jobId)?.abort()
    const queuedIndex = generationQueue.findIndex((item) => item.jobId === jobId)
    if (queuedIndex >= 0) generationQueue.splice(queuedIndex, 1)
    const result = await database.pool.query(`UPDATE admin_content_generation_jobs SET status='canceled',failure_code='canceled',
      completed_at=now(),updated_at=now() WHERE id=$1 AND status IN ('queued','processing') RETURNING *`, [jobId])
    if (!result.rows[0]) {
      const existing = await database.pool.query('SELECT * FROM admin_content_generation_jobs WHERE id=$1', [jobId])
      if (!existing.rows[0]) return sendError(reply, 404, 'generation_job_not_found', '内容生成任务不存在。')
      return reply.send({ data: generationJobResponse(existing.rows[0]) })
    }
    return reply.send({ data: generationJobResponse(result.rows[0]) })
  })

  app.post('/v1/admin/content/generation-jobs/:jobId/insert', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { jobId } = z.object({ jobId: z.uuid() }).parse(request.params)
    const input = AdminGenerationJobInsertRequestSchema.parse(request.body)
    const client = await database.pool.connect()
    try {
      await client.query('BEGIN')
      const jobResult = await client.query(`SELECT * FROM admin_content_generation_jobs WHERE id=$1 FOR UPDATE`, [jobId])
      const job = jobResult.rows[0]
      if (!job) { await client.query('ROLLBACK'); return sendError(reply, 404, 'generation_job_not_found', '内容生成任务不存在。') }
      if (job.operation !== 'training_sessions' || job.status !== 'succeeded') { await client.query('ROLLBACK'); return sendError(reply, 409, 'generation_job_not_ready', '完整训练候选尚未生成完成。') }
      const candidates = ((job.result?.candidates ?? []) as Array<{ candidateId: string; session: TrainingSession }>).filter((candidate) => input.candidateIds.includes(candidate.candidateId))
      if (candidates.length !== input.candidateIds.length) { await client.query('ROLLBACK'); return sendError(reply, 422, 'invalid_candidate_selection', '选择的训练候选不存在。') }
      const alreadyInserted = new Set<string>(job.inserted_candidate_ids ?? [])
      if (input.candidateIds.every((candidateId) => alreadyInserted.has(candidateId))) {
        const existing = await client.query('SELECT * FROM content_drafts WHERE id=$1', [job.draft_id])
        await client.query('ROLLBACK')
        return reply.send({ data: draftResponse(existing.rows[0]) })
      }
      const draftResult = await client.query('SELECT * FROM content_drafts WHERE id=$1 FOR UPDATE', [job.draft_id])
      const draft = draftResult.rows[0]
      if (!draft || draft.status !== 'draft') { await client.query('ROLLBACK'); return sendError(reply, 409, 'draft_not_editable', '草稿不存在或不可编辑。') }
      if (draft.revision !== input.revision || job.draft_revision !== input.revision) { await client.query('ROLLBACK'); return sendError(reply, 409, 'generation_job_stale', '草稿已经更新，请重新生成候选。') }
      const bundle = TrainingContentBundleSchema.parse(draft.bundle)
      const catalog = bundle.catalogs[job.catalog_id]
      if (!catalog) { await client.query('ROLLBACK'); return sendError(reply, 422, 'invalid_content_reference', '候选所属章节已经不存在。') }
      for (const candidate of candidates) {
        if (bundle.sessions[candidate.session.sessionId]) { await client.query('ROLLBACK'); return sendError(reply, 409, 'candidate_id_conflict', `训练 ID ${candidate.session.sessionId} 已存在。`) }
        bundle.sessions[candidate.session.sessionId] = TrainingSessionSchema.parse(candidate.session)
        catalog.sessionIds.push(candidate.session.sessionId)
      }
      const validation = validateContentBundle(bundle)
      if (!validation.valid) { await client.query('ROLLBACK'); return reply.status(422).send({ error: { code: 'candidate_content_invalid', message: '候选内容未通过草稿校验。', issues: validation.issues } }) }
      const updated = await client.query(`UPDATE content_drafts SET bundle=$3::jsonb,revision=revision+1,updated_at=now()
        WHERE id=$1 AND revision=$2 RETURNING *`, [draft.id, input.revision, JSON.stringify(bundle)])
      const inserted = [...new Set([...alreadyInserted, ...input.candidateIds])]
      await client.query(`UPDATE admin_content_generation_jobs SET inserted_candidate_ids=$2::jsonb,updated_at=now() WHERE id=$1`, [jobId, JSON.stringify(inserted)])
      await client.query(`INSERT INTO admin_audit_logs (action,target_type,target_id,metadata)
        VALUES ('content.candidates.insert','draft',$1,$2::jsonb)`, [draft.id, JSON.stringify({ jobId, candidateIds: input.candidateIds })])
      await client.query('COMMIT')
      return reply.send({ data: draftResponse(updated.rows[0]) })
    } catch (cause) {
      await client.query('ROLLBACK')
      throw cause
    } finally { client.release() }
  })

  app.get('/v1/admin/content/drafts/:id/reviews', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const result = await database.pool.query('SELECT * FROM content_drafts WHERE id=$1', [id])
    if (!result.rows[0]) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    const readiness = await draftReadiness(database.pool as unknown as Queryable, result.rows[0])
    return reply.send({ data: { items: readiness.reviews } })
  })

  app.put('/v1/admin/content/drafts/:id/sessions/:sessionId/review', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id, sessionId } = z.object({ id: z.uuid(), sessionId: z.string().regex(/^[a-z0-9-]+$/) }).parse(request.params)
    const input = AdminContentReviewUpdateRequestSchema.parse(request.body)
    const draftResult = await database.pool.query('SELECT * FROM content_drafts WHERE id=$1', [id])
    const draft = draftResult.rows[0]
    if (!draft) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    if (draft.status !== 'draft') return sendError(reply, 409, 'draft_not_editable', '已发布草稿不能更新审核。')
    if (draft.revision !== input.revision) return sendError(reply, 409, 'draft_conflict', '草稿已更新，请重新加载。')
    const bundle = TrainingContentBundleSchema.safeParse(draft.bundle)
    const session = bundle.success ? bundle.data.sessions[sessionId] : undefined
    if (!session) return sendError(reply, 422, 'invalid_content_reference', '训练不存在或草稿尚未通过结构解析。')
    const digest = sessionDigest(session)
    if (input.contentDigest !== digest) return sendError(reply, 409, 'content_review_stale', '训练内容已经变化，请重新检查。')
    const reviewerLabel = input.reviewerLabel?.trim() || null
    if (session.riskLevel === 'medium' && (!reviewerLabel || reviewerLabel === input.operatorLabel.trim())) {
      return sendError(reply, 422, 'secondary_reviewer_required', '中风险训练需要填写不同于操作人的复核人。')
    }
    const updated = await database.pool.query(`INSERT INTO content_session_reviews
      (draft_id,session_id,content_digest,checklist,operator_label,reviewer_label,note)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
      ON CONFLICT (draft_id,session_id) DO UPDATE SET content_digest=excluded.content_digest,
        checklist=excluded.checklist,operator_label=excluded.operator_label,reviewer_label=excluded.reviewer_label,
        note=excluded.note,reviewed_at=now(),updated_at=now() RETURNING *`,
    [id, sessionId, digest, JSON.stringify(input.checklist), input.operatorLabel.trim(), reviewerLabel, input.note ?? null])
    const row = updated.rows[0]
    await database.pool.query(`INSERT INTO admin_audit_logs (action,target_type,target_id,metadata)
      VALUES ('content.session.review','session',$1,$2::jsonb)`, [sessionId, JSON.stringify({ draftId: id, digest, riskLevel: session.riskLevel })])
    return reply.send({ data: {
      sessionId, contentDigest: row.content_digest, currentDigest: digest, current: true, riskLevel: session.riskLevel,
      checklist: row.checklist, operatorLabel: row.operator_label, reviewerLabel: row.reviewer_label,
      note: row.note, reviewedAt: row.reviewed_at.toISOString(),
    } })
  })

  app.get('/v1/admin/content/drafts/:id/readiness', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { id } = z.object({ id: z.uuid() }).parse(request.params)
    const result = await database.pool.query('SELECT * FROM content_drafts WHERE id=$1', [id])
    if (!result.rows[0]) return sendError(reply, 404, 'draft_not_found', '草稿不存在。')
    const readiness = await draftReadiness(database.pool as unknown as Queryable, result.rows[0])
    return reply.send({ data: readiness.data })
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
      if (result.error === 'review_required') return reply.status(422).send({ error: { code: 'content_review_required', message: '新增或修改的训练尚未完成审核。', sessionIds: result.sessionIds } })
      return reply.status(422).send({ error: { code: 'content_invalid', message: '内容没有通过发布校验。', issues: result.issues } })
    }
    return reply.status(result.alreadyPublished ? 200 : 201).send({ data: {
      releaseVersion: result.releaseVersion,
      checksum: result.checksum,
    } })
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
    const [daily, sessions, feedbackStats, reviewStats, reportStats] = await Promise.all([
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
      database.pool.query(`SELECT
        count(*) FILTER (WHERE value->>'type'='due_review_answered' AND coalesce(value->>'variantId','')='')::int original_answers,
        count(*) FILTER (WHERE value->>'type'='due_review_answered' AND coalesce(value->>'variantId','')<>'')::int variant_answers,
        avg(CASE WHEN value->>'type'='due_review_answered' AND coalesce(value->>'variantId','')='' AND value ? 'isCorrect' THEN (value->>'isCorrect')::boolean::int END) original_correct_rate,
        avg(CASE WHEN value->>'type'='due_review_answered' AND coalesce(value->>'variantId','')<>'' AND value ? 'isCorrect' THEN (value->>'isCorrect')::boolean::int END) variant_correct_rate
        FROM learning_activity_events WHERE occurred_at >= now() - ($1::int * interval '1 day')`, [days]),
      database.pool.query(`SELECT count(*) FILTER (WHERE name='weekly_report_view')::int views,
        count(*) FILTER (WHERE name='weekly_report_action')::int actions FROM analytics_events
        WHERE occurred_at >= now() - ($1::int * interval '1 day')`, [days]),
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
      review: {
        originalAnswers: Number(reviewStats.rows[0].original_answers),
        variantAnswers: Number(reviewStats.rows[0].variant_answers),
        originalCorrectRate: reviewStats.rows[0].original_correct_rate === null ? null : Number(reviewStats.rows[0].original_correct_rate),
        variantCorrectRate: reviewStats.rows[0].variant_correct_rate === null ? null : Number(reviewStats.rows[0].variant_correct_rate),
        weeklyReportViews: Number(reportStats.rows[0].views),
        weeklyReportActions: Number(reportStats.rows[0].actions),
      },
    } })
  })

  app.get('/v1/admin/learning-quality', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const input = z.object({
      window: z.enum(['7d', '30d']).default('30d'),
      releaseVersion: z.coerce.number().int().positive().optional(),
      catalogId: z.string().regex(/^[a-z0-9-]+$/).optional(),
      sessionId: z.string().regex(/^[a-z0-9-]+$/).optional(),
    }).parse(request.query)
    return reply.send({ data: await buildLearningQuality(database, input) })
  })

  app.patch('/v1/admin/learning-quality/issues/:issueKey', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { issueKey } = z.object({ issueKey: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params)
    const input = ContentQualityIssueUpdateRequestSchema.parse(request.body)
    const [thirtyDay, sevenDay] = await Promise.all([
      buildLearningQuality(database, { window: '30d' }),
      buildLearningQuality(database, { window: '7d' }),
    ])
    const issue = thirtyDay.issues.find((item) => item.issueKey === issueKey)
      ?? sevenDay.issues.find((item) => item.issueKey === issueKey)
    if (!issue) return sendError(reply, 404, 'content_quality_issue_not_found', '当前版本中没有这条待优化信号。')
    const resolved = ['resolved', 'dismissed'].includes(input.status)
    await database.pool.query(`INSERT INTO content_quality_issue_states
      (issue_key, release_version, session_id, signal, status, internal_note, metric_snapshot, resolved_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,CASE WHEN $8 THEN now() ELSE NULL END)
      ON CONFLICT (issue_key) DO UPDATE SET status=excluded.status, internal_note=excluded.internal_note,
      metric_snapshot=excluded.metric_snapshot, updated_at=now(), resolved_at=excluded.resolved_at`, [
      issueKey, issue.releaseVersion, issue.sessionId, issue.signal, input.status, input.internalNote ?? null,
      JSON.stringify({ value: issue.value, threshold: issue.threshold, sampleSize: issue.sampleSize }), resolved,
    ])
    await database.pool.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('content.quality.status.update','content_quality_issue',$1,$2::jsonb)`, [issueKey, JSON.stringify({ status: input.status, sessionId: issue.sessionId, releaseVersion: issue.releaseVersion })])
    return reply.send({ data: { ...issue, status: input.status, internalNote: input.internalNote ?? null, updatedAt: new Date().toISOString() } })
  })

  app.get('/v1/admin/operations', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { window } = z.object({ window: z.enum(['1h', '24h', '7d']).default('24h') }).parse(request.query)
    const interval = window === '1h' ? '1 hour' : window === '24h' ? '24 hours' : '7 days'
    const bucket = window === '1h'
      ? `date_trunc('minute', received_at) - (extract(minute FROM received_at)::int % 10) * interval '1 minute'`
      : window === '24h' ? `date_trunc('hour', received_at)` : `date_trunc('day', received_at)`
    const [summary, daily, pages, versions, issues, content, model] = await Promise.all([
      database.pool.query(`SELECT count(*)::int total, count(DISTINCT account_id)::int affected_accounts,
        count(DISTINCT fingerprint) FILTER (WHERE status <> 'resolved')::int unresolved
        FROM client_error_reports WHERE received_at >= now() - $1::interval`, [interval]),
      database.pool.query(`SELECT to_char(${bucket}, 'YYYY-MM-DD HH24:MI') time,
        count(*) FILTER (WHERE severity='warning')::int warnings,
        count(*) FILTER (WHERE severity='error')::int errors,
        count(*) FILTER (WHERE severity='fatal')::int fatals
        FROM client_error_reports WHERE received_at >= now() - $1::interval GROUP BY 1 ORDER BY 1`, [interval]),
      database.pool.query(`SELECT page, count(*)::int count FROM client_error_reports
        WHERE received_at >= now() - $1::interval GROUP BY page ORDER BY count DESC LIMIT 10`, [interval]),
      database.pool.query(`SELECT app_version, count(*)::int count FROM client_error_reports
        WHERE received_at >= now() - $1::interval GROUP BY app_version ORDER BY count DESC LIMIT 10`, [interval]),
      database.pool.query(`SELECT fingerprint, category, severity, page, error_code,
        count(*)::int count, count(DISTINCT account_id)::int affected_accounts,
        min(occurred_at) first_seen_at, max(occurred_at) last_seen_at,
        CASE WHEN bool_or(status='new') THEN 'new' WHEN bool_or(status='in_progress') THEN 'in_progress' ELSE 'resolved' END status,
        (array_agg(internal_note ORDER BY updated_at DESC) FILTER (WHERE internal_note IS NOT NULL))[1] internal_note
        FROM client_error_reports WHERE received_at >= now() - $1::interval
        GROUP BY fingerprint, category, severity, page, error_code
        ORDER BY max(occurred_at) DESC LIMIT 100`, [interval]),
      database.pool.query('SELECT release_version FROM content_releases ORDER BY release_version DESC LIMIT 1'),
      database.pool.query('SELECT model_id FROM ai_model_configs WHERE active=true LIMIT 1'),
    ])
    const total = Number(summary.rows[0]?.total ?? 0)
    const fatalCount = daily.rows.reduce((sum, row) => sum + Number(row.fatals), 0)
    const activeModelId = model.rows[0]?.model_id ?? null
    const apiMetrics = ai?.runtimeMetrics?.snapshot(window === '1h' ? 60 * 60 * 1000 : window === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000)
      ?? { requests: 0, errorRate: 0, latencyP50: null, latencyP95: null }
    const level = fatalCount > 0 || total >= 100 || apiMetrics.errorRate >= 0.1
      ? 'critical'
      : total >= 20 || apiMetrics.errorRate >= 0.03 ? 'attention' : 'normal'
    return reply.send({ data: {
      window,
      generatedAt: new Date().toISOString(),
      services: {
        process: 'ok', database: 'ok', ai: ai?.configured ? (activeModelId ? 'ok' : 'unavailable') : 'disabled',
        content: content.rows[0] ? 'ok' : 'unavailable', currentContentVersion: content.rows[0]?.release_version ?? null, activeModelId,
      },
      summary: { total, unresolved: Number(summary.rows[0]?.unresolved ?? 0), affectedAccounts: Number(summary.rows[0]?.affected_accounts ?? 0), level },
      api: apiMetrics,
      daily: daily.rows.map((row) => ({ time: row.time, warnings: Number(row.warnings), errors: Number(row.errors), fatals: Number(row.fatals) })),
      pages: pages.rows.map((row) => ({ page: row.page, count: Number(row.count) })),
      versions: versions.rows.map((row) => ({ appVersion: row.app_version, count: Number(row.count) })),
      issues: issues.rows.map((row) => ({
        fingerprint: row.fingerprint, category: row.category, severity: row.severity, page: row.page,
        errorCode: row.error_code, count: Number(row.count), affectedAccounts: Number(row.affected_accounts),
        firstSeenAt: row.first_seen_at.toISOString(), lastSeenAt: row.last_seen_at.toISOString(),
        status: row.status, internalNote: row.internal_note,
      })),
    } })
  })

  app.patch('/v1/admin/operations/errors/:fingerprint', async (request, reply) => {
    if (!await authorizeAdmin(request, reply, admin)) return
    const { fingerprint } = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.params)
    const input = AdminClientErrorUpdateRequestSchema.parse(request.body)
    const updated = await database.pool.query(`UPDATE client_error_reports SET status=$2::varchar, internal_note=$3,
      updated_at=now(), resolved_at=CASE WHEN $2::varchar='resolved' THEN now() ELSE NULL END
      WHERE fingerprint=$1 RETURNING report_id`, [fingerprint, input.status, input.internalNote ?? null])
    if (!updated.rowCount) return sendError(reply, 404, 'client_error_not_found', '错误报告不存在。')
    await database.pool.query(`INSERT INTO admin_audit_logs (action, target_type, target_id, metadata)
      VALUES ('client_error.status.update', 'client_error', $1, $2::jsonb)`, [fingerprint, JSON.stringify({ status: input.status })])
    return reply.send({ data: { fingerprint, status: input.status, internalNote: input.internalNote ?? null } })
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
    const [summary, statuses, models, ratings, generation, generationOperations] = await Promise.all([
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
      database.pool.query(`SELECT count(*)::int total,
        count(*) FILTER (WHERE status='succeeded')::int succeeded,
        count(*) FILTER (WHERE status='failed')::int failed,
        coalesce(sum(prompt_tokens),0)::int prompt_tokens,
        coalesce(sum(completion_tokens),0)::int completion_tokens,
        coalesce(sum(estimated_cost_usd),0)::float estimated_cost_usd
        FROM admin_ai_generation_runs WHERE created_at >= now() - ($1::int * interval '1 day')`, [days]),
      database.pool.query(`SELECT operation,count(*)::int total,
        count(*) FILTER (WHERE status='succeeded')::int succeeded,
        count(*) FILTER (WHERE status='failed')::int failed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) latency_p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) latency_p95,
        coalesce(sum(format_retries),0)::int format_retries,
        coalesce(sum(prompt_tokens),0)::int prompt_tokens,
        coalesce(sum(completion_tokens),0)::int completion_tokens,
        coalesce(sum(estimated_cost_usd),0)::float estimated_cost_usd
        FROM admin_ai_generation_runs WHERE created_at >= now() - ($1::int * interval '1 day')
        GROUP BY operation ORDER BY operation`, [days]),
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
      contentGeneration: {
        total: Number(generation.rows[0].total), succeeded: Number(generation.rows[0].succeeded), failed: Number(generation.rows[0].failed),
        promptTokens: Number(generation.rows[0].prompt_tokens), completionTokens: Number(generation.rows[0].completion_tokens), estimatedCostUsd: Number(generation.rows[0].estimated_cost_usd),
        operations: generationOperations.rows
          .filter((item) => ['review_variants', 'session_outlines', 'training_sessions'].includes(item.operation))
          .map((item) => ({
            operation: item.operation,
            total: Number(item.total),
            succeeded: Number(item.succeeded),
            failed: Number(item.failed),
            formatRetryRate: item.total ? Math.min(1, Number(item.format_retries) / Number(item.total)) : 0,
            latencyP50: item.latency_p50 === null ? null : Number(item.latency_p50),
            latencyP95: item.latency_p95 === null ? null : Number(item.latency_p95),
            promptTokens: Number(item.prompt_tokens),
            completionTokens: Number(item.completion_tokens),
            estimatedCostUsd: Number(item.estimated_cost_usd),
          })),
      },
    } })
  })
}
