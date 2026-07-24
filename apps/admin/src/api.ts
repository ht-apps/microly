import {
  AdminContentIndexResponseSchema,
  AdminContentReleaseSnapshotResponseSchema,
  AdminDraftDeleteResponseSchema,
  AdminDraftResponseSchema,
  AdminDraftValidationResponseSchema,
  AdminFeedbackListResponseSchema,
  AdminFeedbackResponseSchema,
  AdminMetricsResponseSchema,
  AdminAiConfigResponseSchema,
  AdminAiMetricsResponseSchema,
  AdminPublishResponseSchema,
  AdminSessionResponseSchema,
  AdminWithdrawResponseSchema,
  AdminReviewVariantGenerateResponseSchema,
  AdminOperationsResponseSchema,
  AdminLearningQualityResponseSchema,
  ContentQualityIssueUpdateResponseSchema,
  AdminClientErrorUpdateResponseSchema,
  AdminContentGenerationJobListResponseSchema,
  AdminContentGenerationJobResponseSchema,
  AdminContentReadinessResponseSchema,
  AdminContentReviewListResponseSchema,
  AdminContentReviewResponseSchema,
  type AdminContentDraft,
  type AdminContentGenerationJob,
  type AdminContentIndex,
  type AdminContentReadiness,
  type AdminContentReview,
  type AdminContentReleaseSnapshot,
  type AdminDraftValidation,
  type AdminFeedback,
  type AdminFeedbackList,
  type AdminMetrics,
  type AdminAiModelConfig,
  type AdminAiMetrics,
  type AdminReviewVariantGenerate,
  type AdminOperations,
  type AdminLearningQuality,
  type ContentQualityIssue,
  type AdminSessionOutline,
} from '@microly/api-contract'

const TOKEN_KEY = 'microly:admin-token'
const UNAUTHORIZED_EVENT = 'microly:admin-unauthorized'
const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')

type DataSchema<T> = { parse: (value: unknown) => { data: T } }
type RequestOptions<T> = RequestInit & { schema: DataSchema<T> }

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function readAdminToken() { return sessionStorage.getItem(TOKEN_KEY) ?? '' }
export function saveAdminToken(token: string) { sessionStorage.setItem(TOKEN_KEY, token) }
export function clearAdminToken() { sessionStorage.removeItem(TOKEN_KEY) }

export async function adminRequest<T>(path: string, token: string, options: RequestOptions<T>): Promise<T> {
  const { schema, ...init } = options
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined && init.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  let value: unknown = {}
  try {
    const text = await response.text()
    value = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError(502, 'invalid_response', '服务返回了无法识别的内容。')
  }
  if (!response.ok) {
    const candidate = value as { error?: { code?: string; message?: string } }
    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(
      response.status,
      candidate.error?.code ?? 'request_failed',
      candidate.error?.message ?? '请求失败。',
    )
  }
  try {
    return schema.parse(value).data
  } catch {
    throw new ApiError(502, 'invalid_response', '服务返回的数据不符合接口约定。')
  }
}

function json(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, body: JSON.stringify(body) }
}

export const adminApi = {
  verifySession: (token: string) => adminRequest('/v1/admin/session', token, { schema: AdminSessionResponseSchema }),
  getMetrics: (token: string, window: '7d' | '30d') => adminRequest<AdminMetrics>(
    `/v1/admin/metrics?window=${window}`, token, { schema: AdminMetricsResponseSchema },
  ),
  getLearningQuality: (token: string, input: { window: '7d' | '30d'; releaseVersion?: number; catalogId?: string; sessionId?: string }) => {
    const query = new URLSearchParams({ window: input.window })
    if (input.releaseVersion) query.set('releaseVersion', String(input.releaseVersion))
    if (input.catalogId) query.set('catalogId', input.catalogId)
    if (input.sessionId) query.set('sessionId', input.sessionId)
    return adminRequest<AdminLearningQuality>(`/v1/admin/learning-quality?${query}`, token, { schema: AdminLearningQualityResponseSchema })
  },
  updateLearningQualityIssue: (token: string, issueKey: string, status: ContentQualityIssue['status'], internalNote: string | null) => adminRequest<ContentQualityIssue>(
    `/v1/admin/learning-quality/issues/${issueKey}`, token,
    { ...json('PATCH', { status, internalNote }), schema: ContentQualityIssueUpdateResponseSchema },
  ),
  getContentIndex: (token: string) => adminRequest<AdminContentIndex>(
    '/v1/admin/content/releases', token, { schema: AdminContentIndexResponseSchema },
  ),
  getRelease: (token: string, version: number) => adminRequest<AdminContentReleaseSnapshot>(
    `/v1/admin/content/releases/${version}`, token, { schema: AdminContentReleaseSnapshotResponseSchema },
  ),
  getDraft: (token: string, id: string) => adminRequest<AdminContentDraft>(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}`, token, { schema: AdminDraftResponseSchema },
  ),
  createDraft: (token: string, baseReleaseVersion?: number) => adminRequest<AdminContentDraft>(
    '/v1/admin/content/drafts', token, { ...json('POST', baseReleaseVersion ? { baseReleaseVersion } : {}), schema: AdminDraftResponseSchema },
  ),
  saveDraft: (token: string, id: string, revision: number, bundle: unknown) => adminRequest<AdminContentDraft>(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}`, token,
    { ...json('PUT', { revision, bundle }), schema: AdminDraftResponseSchema },
  ),
  deleteDraft: (token: string, id: string, revision: number) => adminRequest<{ id: string }>(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}`, token,
    { ...json('DELETE', { revision }), schema: AdminDraftDeleteResponseSchema },
  ),
  restoreDraft: (token: string, id: string, revision: number) => adminRequest<AdminContentDraft>(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}/restore`, token,
    { ...json('POST', { revision }), schema: AdminDraftResponseSchema },
  ),
  validateDraft: (token: string, id: string) => adminRequest<AdminDraftValidation>(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}/validate`, token,
    { ...json('POST'), schema: AdminDraftValidationResponseSchema },
  ),
  generateReviewVariants: (token: string, id: string, sessionId: string, revision: number, count = 3) => adminRequest<AdminReviewVariantGenerate>(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/review-variants/generate`, token,
    { ...json('POST', { revision, count }), schema: AdminReviewVariantGenerateResponseSchema },
  ),
  publishDraft: (token: string, id: string, revision: number, reason: string) => adminRequest(
    `/v1/admin/content/drafts/${encodeURIComponent(id)}/publish`, token,
    { ...json('POST', { revision, reason }), schema: AdminPublishResponseSchema },
  ),
  createRollbackDraft: (token: string, version: number) => adminRequest<AdminContentDraft>(
    `/v1/admin/content/releases/${version}/rollback-draft`, token,
    { ...json('POST'), schema: AdminDraftResponseSchema },
  ),
  withdrawSession: (token: string, sessionId: string, reason: string) => adminRequest(
    `/v1/admin/content/current/sessions/${encodeURIComponent(sessionId)}/withdraw`, token,
    { ...json('POST', { confirmation: 'WITHDRAW', reason }), schema: AdminWithdrawResponseSchema },
  ),
  getFeedback: (token: string, input: { status?: string; category?: string; page: number; pageSize: number }) => {
    const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) })
    if (input.status) query.set('status', input.status)
    if (input.category) query.set('category', input.category)
    return adminRequest<AdminFeedbackList>(`/v1/admin/feedback?${query}`, token, { schema: AdminFeedbackListResponseSchema })
  },
  updateFeedback: (token: string, id: string, status: AdminFeedback['status'], internalNote: string | null) => adminRequest<AdminFeedback>(
    `/v1/admin/feedback/${encodeURIComponent(id)}`, token,
    { ...json('PATCH', { status, internalNote }), schema: AdminFeedbackResponseSchema },
  ),
  getAiConfig: (token: string) => adminRequest<{ configured: boolean; activeModelId: string | null; models: AdminAiModelConfig[] }>(
    '/v1/admin/ai/config', token, { schema: AdminAiConfigResponseSchema },
  ),
  refreshAiModels: (token: string) => adminRequest<{ configured: boolean; activeModelId: string | null; models: AdminAiModelConfig[] }>(
    '/v1/admin/ai/models/refresh', token, { ...json('POST'), schema: AdminAiConfigResponseSchema },
  ),
  updateAiConfig: (token: string, input: {
    revision: number; modelId: string; thinkingEnabled: boolean; maxTokens: number; temperature: number;
    timeoutMs: number; dailyQuota: number; inputCacheHitPrice: number; inputCacheMissPrice: number; outputPrice: number; reason: string;
  }) => adminRequest<{ configured: boolean; activeModelId: string | null; models: AdminAiModelConfig[] }>(
    '/v1/admin/ai/config', token, { ...json('PUT', input), schema: AdminAiConfigResponseSchema },
  ),
  getAiMetrics: (token: string, window: '7d' | '30d') => adminRequest<AdminAiMetrics>(
    `/v1/admin/ai/metrics?window=${window}`, token, { schema: AdminAiMetricsResponseSchema },
  ),
  getOperations: (token: string, window: '1h' | '24h' | '7d') => adminRequest<AdminOperations>(
    `/v1/admin/operations?window=${window}`, token, { schema: AdminOperationsResponseSchema },
  ),
  updateClientError: (token: string, fingerprint: string, status: 'new' | 'in_progress' | 'resolved', internalNote: string | null) => adminRequest(
    `/v1/admin/operations/errors/${fingerprint}`, token,
    { ...json('PATCH', { status, internalNote }), schema: AdminClientErrorUpdateResponseSchema },
  ),
  generateSessionOutlines: (token: string, draftId: string, catalogId: string, input: {
    requestId: string; revision: number; count: number; difficulties: Array<'L1' | 'L2' | 'L3'>; brief: string
  }) => adminRequest<AdminContentGenerationJob>(
    `/v1/admin/content/drafts/${encodeURIComponent(draftId)}/catalogs/${encodeURIComponent(catalogId)}/session-outlines/generate`, token,
    { ...json('POST', input), schema: AdminContentGenerationJobResponseSchema },
  ),
  generateTrainingSessions: (token: string, draftId: string, input: {
    requestId: string; revision: number; outlineJobId: string; outlineIds: string[]; outlines?: AdminSessionOutline[]; reviewVariantCount: 2
  }) => adminRequest<AdminContentGenerationJob>(
    `/v1/admin/content/drafts/${encodeURIComponent(draftId)}/sessions/generate`, token,
    { ...json('POST', input), schema: AdminContentGenerationJobResponseSchema },
  ),
  getGenerationJobs: (token: string, draftId: string) => adminRequest<{ items: AdminContentGenerationJob[] }>(
    `/v1/admin/content/generation-jobs?draftId=${encodeURIComponent(draftId)}`, token,
    { schema: AdminContentGenerationJobListResponseSchema },
  ),
  getGenerationJob: (token: string, jobId: string) => adminRequest<AdminContentGenerationJob>(
    `/v1/admin/content/generation-jobs/${encodeURIComponent(jobId)}`, token,
    { schema: AdminContentGenerationJobResponseSchema },
  ),
  cancelGenerationJob: (token: string, jobId: string) => adminRequest<AdminContentGenerationJob>(
    `/v1/admin/content/generation-jobs/${encodeURIComponent(jobId)}/cancel`, token,
    { ...json('POST'), schema: AdminContentGenerationJobResponseSchema },
  ),
  insertGenerationCandidates: (token: string, jobId: string, revision: number, candidateIds: string[]) => adminRequest<AdminContentDraft>(
    `/v1/admin/content/generation-jobs/${encodeURIComponent(jobId)}/insert`, token,
    { ...json('POST', { revision, candidateIds }), schema: AdminDraftResponseSchema },
  ),
  getContentReviews: (token: string, draftId: string) => adminRequest<{ items: AdminContentReview[] }>(
    `/v1/admin/content/drafts/${encodeURIComponent(draftId)}/reviews`, token,
    { schema: AdminContentReviewListResponseSchema },
  ),
  reviewSession: (token: string, draftId: string, sessionId: string, input: {
    revision: number; contentDigest: string; checklist: Record<string, true>; operatorLabel: string; reviewerLabel?: string | null; note?: string | null
  }) => adminRequest<AdminContentReview>(
    `/v1/admin/content/drafts/${encodeURIComponent(draftId)}/sessions/${encodeURIComponent(sessionId)}/review`, token,
    { ...json('PUT', input), schema: AdminContentReviewResponseSchema },
  ),
  getContentReadiness: (token: string, draftId: string) => adminRequest<AdminContentReadiness>(
    `/v1/admin/content/drafts/${encodeURIComponent(draftId)}/readiness`, token,
    { schema: AdminContentReadinessResponseSchema },
  ),
}

export const adminUnauthorizedEvent = UNAUTHORIZED_EVENT
