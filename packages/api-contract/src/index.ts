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
