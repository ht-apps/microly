import { TrainingContentBundleSchema } from '@microly/content-schema'
import { z } from 'zod'

const IsoTimeSchema = z.iso.datetime({ offset: true })
const IdentifierSchema = z.string().min(1).max(160)
const SessionIdSchema = z.string().regex(/^[a-z0-9-]+$/)
const ContentVersionSchema = z.number().int().positive()

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
})

export const ContentResponseSchema = z.object({
  data: z.object({
    bundle: TrainingContentBundleSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }),
})

export const GuestAuthRequestSchema = z.object({
  installationId: z.uuid(),
}).strict()

export const GuestAuthResponseSchema = z.object({
  data: z.object({
    guestId: z.uuid(),
    accountId: z.uuid(),
    authType: z.enum(['guest', 'wechat']),
    token: z.string().min(32),
    expiresAt: IsoTimeSchema,
  }),
})

export const WechatAuthRequestSchema = z.object({
  code: z.string().min(1).max(256),
}).strict()

export const AccountSessionSchema = z.object({
  accountId: z.uuid(),
  authType: z.enum(['guest', 'wechat']),
  token: z.string().min(32),
  expiresAt: IsoTimeSchema,
})

export const WechatAuthResponseSchema = z.object({
  data: AccountSessionSchema.extend({ merged: z.boolean() }),
})

export const AccountResponseSchema = z.object({
  data: z.object({
    accountId: z.uuid(),
    authType: z.enum(['guest', 'wechat']),
    createdAt: IsoTimeSchema,
  }),
})

export const TrainingCompletionSchema = z.object({
  syncId: IdentifierSchema,
  sessionId: SessionIdSchema,
  contentVersion: ContentVersionSchema,
  selectedOptionId: z.string().regex(/^[a-z0-9-]+$/),
  startedAt: IsoTimeSchema,
  completedAt: IsoTimeSchema,
}).strict().refine(
  (completion) => Date.parse(completion.startedAt) <= Date.parse(completion.completedAt),
  { message: '完成时间不能早于开始时间', path: ['completedAt'] },
)

export const TrainingCompletionResponseSchema = z.object({
  data: TrainingCompletionSchema,
})

export const TrainingCompletionListResponseSchema = z.object({
  data: z.array(TrainingCompletionSchema),
})

const AppOpenPropertiesSchema = z.object({ source: z.string().max(40).optional() }).strict()
const OnboardingViewPropertiesSchema = z.object({ isFirstVisit: z.boolean() }).strict()
const PreferenceSubmitPropertiesSchema = z.object({
  selectedSkills: z.array(z.string().max(60)).max(2),
  skipped: z.boolean(),
}).strict()
const TrainingStartPropertiesSchema = z.object({
  sessionId: z.string().max(80),
  contentVersion: z.number().int().positive(),
  entry: z.enum(['onboarding', 'today', 'course', 'challenge']),
}).strict()
const OptionSelectPropertiesSchema = z.object({
  sessionId: z.string().max(80),
  contentVersion: z.number().int().positive(),
  optionId: z.string().max(80),
  displayPosition: z.number().int().min(0).max(10),
  rating: z.enum(['recommended', 'risky', 'not_recommended']),
}).strict()
const TrainingCompletePropertiesSchema = z.object({
  sessionId: z.string().max(80),
  contentVersion: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  practiceUsed: z.boolean(),
}).strict()
const LoginPromptPropertiesSchema = z.object({ entry: z.enum(['training_complete', 'profile']) }).strict()
const WechatLoginSuccessPropertiesSchema = z.object({ merged: z.boolean() }).strict()
const SyncSuccessPropertiesSchema = z.object({ recordCount: z.number().int().nonnegative() }).strict()
const FeedbackSubmitPropertiesSchema = z.object({ category: z.enum(['content_error', 'product_suggestion', 'inappropriate_content']) }).strict()
const AiEvaluationPropertiesSchema = z.object({
  sessionId: SessionIdSchema,
  status: z.enum(['submitted', 'succeeded', 'degraded', 'blocked', 'quota_exceeded', 'canceled']),
  modelConfigRevision: z.number().int().positive().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
}).strict()
const AiEvaluationRatingPropertiesSchema = z.object({ helpful: z.boolean() }).strict()

function event<Name extends string, Schema extends z.ZodType>(name: Name, properties: Schema) {
  return z.object({
    eventId: z.uuid(),
    name: z.literal(name),
    occurredAt: IsoTimeSchema,
    properties,
  }).strict()
}

export const AnalyticsEventSchema = z.discriminatedUnion('name', [
  event('app_open', AppOpenPropertiesSchema),
  event('onboarding_view', OnboardingViewPropertiesSchema),
  event('preference_submit', PreferenceSubmitPropertiesSchema),
  event('training_start', TrainingStartPropertiesSchema),
  event('option_select', OptionSelectPropertiesSchema),
  event('training_complete', TrainingCompletePropertiesSchema),
  event('login_prompt', LoginPromptPropertiesSchema),
  event('wechat_login_success', WechatLoginSuccessPropertiesSchema),
  event('sync_success', SyncSuccessPropertiesSchema),
  event('feedback_submit', FeedbackSubmitPropertiesSchema),
  event('ai_evaluation', AiEvaluationPropertiesSchema),
  event('ai_evaluation_rating', AiEvaluationRatingPropertiesSchema),
])

export const AnalyticsBatchRequestSchema = z.object({
  events: z.array(AnalyticsEventSchema).min(1).max(50),
}).strict()

export const AnalyticsBatchResponseSchema = z.object({
  data: z.object({ accepted: z.number().int().nonnegative() }),
})

export const SyncPreferenceSchema = z.object({
  schemaVersion: z.literal(1),
  onboardingStatus: z.literal('completed'),
  selectedCatalogIds: z.array(SessionIdSchema).max(2),
  completedAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}).strict()

export const FavoriteSyncRecordSchema = z.object({
  favoriteId: IdentifierSchema,
  sessionId: SessionIdSchema,
  contentVersion: ContentVersionSchema,
  cardId: SessionIdSchema,
  active: z.boolean(),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
}).strict()

export const ReviewSyncRecordSchema = z.object({
  reviewId: IdentifierSchema,
  sessionId: SessionIdSchema,
  contentVersion: ContentVersionSchema,
  sourceCardId: SessionIdSchema,
  lastSelectedOptionId: SessionIdSchema,
  dueAt: IsoTimeSchema,
  intervalDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]),
  consecutiveCorrect: z.number().int().nonnegative(),
  lastResult: z.enum(['correct', 'incorrect']),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  lastReviewedAt: IsoTimeSchema.nullable(),
}).strict()

export const TrainingProgressSyncRecordSchema = z.object({
  sessionId: SessionIdSchema,
  contentVersion: ContentVersionSchema,
  attemptId: IdentifierSchema,
  status: z.enum(['not_started', 'in_progress', 'completed']),
  currentCardIndex: z.number().int().nonnegative(),
  selectedOptionId: SessionIdSchema.nullable(),
  choiceConfirmed: z.boolean(),
  startedAt: IsoTimeSchema.nullable(),
  updatedAt: IsoTimeSchema,
  completedAt: IsoTimeSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status !== 'not_started' && !value.startedAt) {
    context.addIssue({ code: 'custom', message: '进行中训练必须包含开始时间。', path: ['startedAt'] })
  }
  if (value.status === 'completed' && (!value.completedAt || !value.choiceConfirmed || !value.selectedOptionId)) {
    context.addIssue({ code: 'custom', message: '完成训练缺少必要状态。', path: ['status'] })
  }
  if (value.choiceConfirmed && !value.selectedOptionId) {
    context.addIssue({ code: 'custom', message: '确认选择时必须包含选项。', path: ['selectedOptionId'] })
  }
})

export const LearningActivitySyncRecordSchema = z.discriminatedUnion('type', [
  z.object({
    eventId: IdentifierSchema,
    type: z.literal('training_completed'),
    occurredAt: IsoTimeSchema,
    localDateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sessionId: SessionIdSchema,
  }).strict(),
  z.object({
    eventId: IdentifierSchema,
    type: z.literal('due_review_answered'),
    occurredAt: IsoTimeSchema,
    localDateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sessionId: SessionIdSchema,
    reviewId: IdentifierSchema,
  }).strict(),
])

export const SyncRequestSchema = z.object({
  requestId: z.uuid(),
  preference: SyncPreferenceSchema.nullable().optional(),
  favorites: z.array(FavoriteSyncRecordSchema).max(200).default([]),
  reviews: z.array(ReviewSyncRecordSchema).max(200).default([]),
  progress: z.array(TrainingProgressSyncRecordSchema).max(200).default([]),
  activities: z.array(LearningActivitySyncRecordSchema).max(1000).default([]),
}).strict()

export const SyncSnapshotSchema = z.object({
  preference: SyncPreferenceSchema.nullable(),
  favorites: z.array(FavoriteSyncRecordSchema),
  reviews: z.array(ReviewSyncRecordSchema),
  progress: z.array(TrainingProgressSyncRecordSchema),
  activities: z.array(LearningActivitySyncRecordSchema),
  serverTime: IsoTimeSchema,
})

export const SyncResponseSchema = z.object({ data: SyncSnapshotSchema })

export const FeedbackRequestSchema = z.object({
  category: z.enum(['content_error', 'product_suggestion', 'inappropriate_content']),
  detail: z.string().trim().min(10).max(500),
  sessionId: SessionIdSchema.optional(),
  contentVersion: ContentVersionSchema.optional(),
}).strict().refine(
  (value) => (value.sessionId === undefined) === (value.contentVersion === undefined),
  { message: '训练上下文必须成对提供。' },
)

export const FeedbackResponseSchema = z.object({
  data: z.object({ feedbackId: z.uuid(), status: z.literal('new') }),
})

export const AiEvaluationStatusSchema = z.enum([
  'queued', 'processing', 'succeeded', 'degraded', 'blocked', 'canceled',
])
export const AiDimensionLevelSchema = z.enum(['met', 'partial', 'missing'])
export const AiSafetyReasonSchema = z.enum([
  'personal_contact', 'company_secret', 'high_risk', 'prompt_injection', 'provider_safety',
])
export const AiEvaluationDimensionSchema = z.object({
  dimensionId: SessionIdSchema,
  level: AiDimensionLevelSchema,
  reason: z.string().trim().min(1).max(160),
}).strict()
export const AiEvaluationResultSchema = z.object({
  mode: z.enum(['ai', 'rule']),
  rubricVersion: IdentifierSchema,
  dimensions: z.array(AiEvaluationDimensionSchema).min(1).max(4),
  summary: z.string().trim().min(1).max(200),
  rewrite: z.string().trim().min(1).max(300).nullable(),
  safety: z.object({
    allowed: z.boolean(),
    reasonCode: AiSafetyReasonSchema.nullable(),
  }).strict(),
  model: z.object({
    provider: z.literal('deepseek'),
    modelId: z.string().min(1).max(100),
    configRevision: z.number().int().positive(),
    promptVersion: z.string().min(1).max(80),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if (!value.safety.allowed && value.rewrite !== null) {
    context.addIssue({ code: 'custom', message: '安全拦截结果不能包含参考改写。', path: ['rewrite'] })
  }
  if (value.safety.allowed && value.safety.reasonCode !== null) {
    context.addIssue({ code: 'custom', message: '安全通过时不能包含拦截原因。', path: ['safety', 'reasonCode'] })
  }
})

export const AiEvaluationCreateRequestSchema = z.object({
  requestId: z.uuid(),
  attemptId: IdentifierSchema,
  sessionId: SessionIdSchema,
  contentVersion: ContentVersionSchema,
  practiceCardId: SessionIdSchema,
  practiceText: z.string().trim().min(10).max(200),
}).strict()

export const AiEvaluationSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  attemptId: IdentifierSchema,
  sessionId: SessionIdSchema,
  contentVersion: ContentVersionSchema,
  practiceCardId: SessionIdSchema,
  status: AiEvaluationStatusSchema,
  result: AiEvaluationResultSchema.nullable(),
  failureCode: z.string().max(80).nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  createdAt: IsoTimeSchema,
  completedAt: IsoTimeSchema.nullable(),
  rating: z.object({ helpful: z.boolean(), reason: z.enum([
    'specific', 'actionable', 'accurate', 'too_generic', 'inaccurate', 'inappropriate',
  ]).nullable() }).strict().nullable(),
}).strict()

export const AiStatusResponseSchema = z.object({ data: z.object({
  enabled: z.boolean(),
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  resetAt: IsoTimeSchema,
  modelId: z.string().nullable(),
}).strict() }).strict()
export const AiEvaluationResponseSchema = z.object({ data: AiEvaluationSchema }).strict()
export const AiEvaluationListResponseSchema = z.object({ data: z.object({
  items: z.array(AiEvaluationSchema),
  nextCursor: z.uuid().nullable(),
}).strict() }).strict()
export const AiEvaluationRatingRequestSchema = z.object({
  helpful: z.boolean(),
  reason: z.enum(['specific', 'actionable', 'accurate', 'too_generic', 'inaccurate', 'inappropriate']).nullable().optional(),
}).strict()

export const AdminAiModelConfigSchema = z.object({
  id: z.uuid(),
  provider: z.literal('deepseek'),
  modelId: z.string().min(1).max(100),
  displayName: z.string().min(1).max(120),
  thinkingEnabled: z.boolean(),
  maxTokens: z.number().int().min(100).max(4000),
  temperature: z.number().min(0).max(2),
  timeoutMs: z.number().int().min(5000).max(60000),
  dailyQuota: z.number().int().min(1).max(100),
  inputCacheHitPrice: z.number().nonnegative(),
  inputCacheMissPrice: z.number().nonnegative(),
  outputPrice: z.number().nonnegative(),
  active: z.boolean(),
  revision: z.number().int().positive(),
  updatedAt: IsoTimeSchema,
}).strict()
export const AdminAiConfigResponseSchema = z.object({ data: z.object({
  configured: z.boolean(),
  activeModelId: z.string().nullable(),
  models: z.array(AdminAiModelConfigSchema),
}).strict() }).strict()
export const AdminAiConfigUpdateRequestSchema = z.object({
  revision: z.number().int().positive(),
  modelId: z.string().min(1).max(100),
  thinkingEnabled: z.boolean(),
  maxTokens: z.number().int().min(100).max(4000),
  temperature: z.number().min(0).max(2),
  timeoutMs: z.number().int().min(5000).max(60000),
  dailyQuota: z.number().int().min(1).max(100),
  inputCacheHitPrice: z.number().nonnegative(),
  inputCacheMissPrice: z.number().nonnegative(),
  outputPrice: z.number().nonnegative(),
  reason: z.string().trim().min(3).max(300),
}).strict()
export const AdminAiMetricsResponseSchema = z.object({ data: z.object({
  window: z.enum(['7d', '30d']),
  total: z.number().int().nonnegative(),
  byStatus: z.record(AiEvaluationStatusSchema, z.number().int().nonnegative()),
  latencyP50: z.number().nonnegative().nullable(),
  latencyP95: z.number().nonnegative().nullable(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  formatRetryRate: z.number().min(0).max(1),
  helpfulRate: z.number().min(0).max(1).nullable(),
  models: z.array(z.object({ modelId: z.string(), count: z.number().int().nonnegative() }).strict()),
}).strict() }).strict()

export const AdminFeedbackStatusSchema = z.enum(['new', 'in_progress', 'resolved', 'dismissed'])
export const AdminDraftStatusSchema = z.enum(['draft', 'published', 'abandoned'])

export const AdminDraftCreateRequestSchema = z.object({
  baseReleaseVersion: ContentVersionSchema.optional(),
}).strict()

export const AdminDraftUpdateRequestSchema = z.object({
  revision: z.number().int().positive(),
  bundle: z.unknown(),
}).strict()

export const AdminPublishRequestSchema = z.object({
  revision: z.number().int().positive(),
  reason: z.string().trim().min(3).max(300),
}).strict()

export const AdminWithdrawRequestSchema = z.object({
  confirmation: z.literal('WITHDRAW'),
  reason: z.string().trim().min(3).max(300),
}).strict()

export const AdminFeedbackUpdateRequestSchema = z.object({
  status: AdminFeedbackStatusSchema,
  internalNote: z.string().trim().max(500).nullable().optional(),
}).strict()

export const AdminValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
})

export const AdminContentReleaseSchema = z.object({
  releaseVersion: ContentVersionSchema,
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  createdFromVersion: ContentVersionSchema.nullable(),
  releaseReason: z.string().nullable(),
  publishedAt: IsoTimeSchema,
  sessionCount: z.number().int().nonnegative(),
})

export const AdminContentDraftSchema = z.object({
  id: z.uuid(),
  baseReleaseVersion: ContentVersionSchema.nullable(),
  bundle: z.unknown(),
  status: AdminDraftStatusSchema,
  revision: z.number().int().positive(),
  publishedReleaseVersion: ContentVersionSchema.nullable(),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
})

export const AdminFeedbackSchema = z.object({
  id: z.uuid(),
  category: z.enum(['content_error', 'product_suggestion', 'inappropriate_content']),
  detail: z.string(),
  sessionId: SessionIdSchema.nullable(),
  contentVersion: ContentVersionSchema.nullable(),
  status: AdminFeedbackStatusSchema,
  internalNote: z.string().nullable(),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  resolvedAt: IsoTimeSchema.nullable(),
})

export const AdminFunnelStageSchema = z.object({
  name: z.enum(['app_open', 'onboarding_view', 'training_start', 'option_select', 'training_complete', 'wechat_login_success']),
  accounts: z.number().int().nonnegative(),
  conversionRate: z.number().min(0).max(1).nullable(),
})

export const AdminMetricsResponseSchema = z.object({
  data: z.object({
    window: z.enum(['7d', '30d']),
    generatedAt: IsoTimeSchema,
    funnel: z.array(AdminFunnelStageSchema).length(6),
    daily: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), starts: z.number().int().nonnegative(), completions: z.number().int().nonnegative() })),
    sessions: z.array(z.object({ sessionId: SessionIdSchema, starts: z.number().int().nonnegative(), completions: z.number().int().nonnegative(), completionRate: z.number().min(0).max(1) })).max(10),
    feedback: z.object({ total: z.number().int().nonnegative(), byStatus: z.record(AdminFeedbackStatusSchema, z.number().int().nonnegative()), byCategory: z.record(z.string(), z.number().int().nonnegative()) }).strict(),
  }).strict(),
}).strict()

export const AdminSessionResponseSchema = z.object({
  data: z.object({ authenticated: z.literal(true) }).strict(),
}).strict()

export const AdminContentIndexResponseSchema = z.object({
  data: z.object({
    currentVersion: ContentVersionSchema.nullable(),
    releases: z.array(AdminContentReleaseSchema),
    drafts: z.array(AdminContentDraftSchema),
  }).strict(),
}).strict()

export const AdminDraftResponseSchema = z.object({ data: AdminContentDraftSchema }).strict()

export const AdminDraftValidationResponseSchema = z.object({
  data: z.object({
    valid: z.boolean(),
    issues: z.array(AdminValidationIssueSchema),
    normalizedBundle: z.unknown().nullable(),
  }).strict(),
}).strict()

export const AdminPublishResponseSchema = z.object({
  data: z.object({
    releaseVersion: ContentVersionSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict()

export const AdminWithdrawResponseSchema = z.object({
  data: z.object({
    sessionId: SessionIdSchema,
    releaseVersion: ContentVersionSchema,
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
}).strict()

export const AdminFeedbackListResponseSchema = z.object({
  data: z.object({
    items: z.array(AdminFeedbackSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
  }).strict(),
}).strict()

export const AdminFeedbackResponseSchema = z.object({ data: AdminFeedbackSchema }).strict()

export type TrainingCompletion = z.infer<typeof TrainingCompletionSchema>
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>
export type AnalyticsBatchRequest = z.infer<typeof AnalyticsBatchRequestSchema>
export type AccountSession = z.infer<typeof AccountSessionSchema>
export type SyncPreference = z.infer<typeof SyncPreferenceSchema>
export type FavoriteSyncRecord = z.infer<typeof FavoriteSyncRecordSchema>
export type ReviewSyncRecord = z.infer<typeof ReviewSyncRecordSchema>
export type TrainingProgressSyncRecord = z.infer<typeof TrainingProgressSyncRecordSchema>
export type LearningActivitySyncRecord = z.infer<typeof LearningActivitySyncRecordSchema>
export type SyncRequest = z.infer<typeof SyncRequestSchema>
export type SyncSnapshot = z.infer<typeof SyncSnapshotSchema>
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>
export type AiEvaluationResult = z.infer<typeof AiEvaluationResultSchema>
export type AiEvaluation = z.infer<typeof AiEvaluationSchema>
export type AiEvaluationCreateRequest = z.infer<typeof AiEvaluationCreateRequestSchema>
export type AdminAiModelConfig = z.infer<typeof AdminAiModelConfigSchema>
export type AdminAiMetrics = z.infer<typeof AdminAiMetricsResponseSchema>['data']
export type AdminContentDraft = z.infer<typeof AdminContentDraftSchema>
export type AdminContentRelease = z.infer<typeof AdminContentReleaseSchema>
export type AdminFeedback = z.infer<typeof AdminFeedbackSchema>
export type AdminMetrics = z.infer<typeof AdminMetricsResponseSchema>['data']
export type AdminContentIndex = z.infer<typeof AdminContentIndexResponseSchema>['data']
export type AdminDraftValidation = z.infer<typeof AdminDraftValidationResponseSchema>['data']
export type AdminFeedbackList = z.infer<typeof AdminFeedbackListResponseSchema>['data']
