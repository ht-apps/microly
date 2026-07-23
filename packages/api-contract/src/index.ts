import { TrainingContentBundleSchema } from '@microly/content-schema'
import { z } from 'zod'

const IsoTimeSchema = z.iso.datetime({ offset: true })
const IdentifierSchema = z.string().min(1).max(160)

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
    token: z.string().min(32),
    expiresAt: IsoTimeSchema,
  }),
})

export const TrainingCompletionSchema = z.object({
  syncId: IdentifierSchema,
  sessionId: z.string().regex(/^[a-z0-9-]+$/),
  contentVersion: z.number().int().positive(),
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
])

export const AnalyticsBatchRequestSchema = z.object({
  events: z.array(AnalyticsEventSchema).min(1).max(50),
}).strict()

export const AnalyticsBatchResponseSchema = z.object({
  data: z.object({ accepted: z.number().int().nonnegative() }),
})

export type TrainingCompletion = z.infer<typeof TrainingCompletionSchema>
export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>
export type AnalyticsBatchRequest = z.infer<typeof AnalyticsBatchRequestSchema>
