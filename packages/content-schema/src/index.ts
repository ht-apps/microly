import { z } from 'zod'

// WeChat Mini Program does not reliably support Zod 4's dynamically generated
// object parsers. Keep all shared schemas on the CSP-safe interpreter path.
z.config({ jitless: true })

const IdentifierSchema = z.string().regex(/^[a-z0-9-]+$/)

export const TrainingOptionRatingSchema = z.enum([
  'recommended',
  'risky',
  'not_recommended',
])

export const OptionFeedbackSchema = z.object({
  interpretation: z.string().min(1).max(140),
  strength: z.string().min(1).max(140),
  risk: z.string().min(1).max(140),
  condition: z.string().min(1).max(140).optional(),
})

export const TrainingOptionSchema = z.object({
  id: IdentifierSchema,
  text: z.string().min(1).max(160),
  rating: TrainingOptionRatingSchema,
  feedback: OptionFeedbackSchema,
})

export const ReviewVariantSchema = z.object({
  variantId: IdentifierSchema,
  title: z.string().min(1).max(40),
  context: z.string().min(40).max(120),
  question: z.string().min(1).max(50),
  prompt: z.string().min(1).max(60),
  options: z.array(TrainingOptionSchema).length(3),
}).superRefine((variant, context) => {
  if (new Set(variant.options.map((option) => option.id)).size !== variant.options.length) {
    context.addIssue({ code: 'custom', message: '复习变体选项 ID 不能重复', path: ['options'] })
  }
  if (variant.options.filter((option) => option.rating === 'recommended').length !== 1) {
    context.addIssue({ code: 'custom', message: '复习变体必须且只能包含一个推荐选项', path: ['options'] })
  }
})

export const ScenarioCardSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('scenario'),
  eyebrow: z.string().min(1).max(30),
  title: z.string().min(1).max(40),
  context: z.string().min(40).max(120),
  question: z.string().min(1).max(50),
})

export const ChoiceCardSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('choice'),
  prompt: z.string().min(1).max(60),
  options: z.array(TrainingOptionSchema).length(3),
}).superRefine((card, context) => {
  const optionIds = new Set(card.options.map((option) => option.id))
  if (optionIds.size !== card.options.length) {
    context.addIssue({
      code: 'custom',
      message: '选项 ID 不能重复',
      path: ['options'],
    })
  }

  const recommendedCount = card.options.filter(
    (option) => option.rating === 'recommended',
  ).length
  if (recommendedCount !== 1) {
    context.addIssue({
      code: 'custom',
      message: '选择卡必须且只能包含一个推荐选项',
      path: ['options'],
    })
  }
})

export const FeedbackCardSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('feedback'),
  title: z.string().min(1).max(40),
  comparisonLabel: z.string().min(1).max(30),
})

export const PrincipleCardSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('principle'),
  title: z.string().min(1).max(40),
  summary: z.string().min(1).max(120),
  formula: z.string().min(1).max(60),
  counterexample: z.string().min(1).max(160),
  example: z.string().min(1).max(200),
})

export const PracticeDimensionSchema = z.object({
  id: IdentifierSchema,
  title: z.string().min(1).max(30),
  description: z.string().min(1).max(100),
  keywords: z.array(z.string().min(1).max(20)).min(1),
})

export const PracticeCardSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('practice'),
  title: z.string().min(1).max(40),
  prompt: z.string().min(1).max(160),
  minLength: z.number().int().min(1).max(200),
  maxLength: z.number().int().min(1).max(200),
  dimensions: z.array(PracticeDimensionSchema).min(1).max(4),
  referenceAnswer: z.string().min(1).max(240),
  disclaimer: z.string().min(1).max(120),
}).refine((card) => card.minLength <= card.maxLength, {
  message: '主动表达最小字数不能大于最大字数',
  path: ['minLength'],
})

export const CompletionCardSchema = z.object({
  id: IdentifierSchema,
  type: z.literal('completion'),
  title: z.string().min(1).max(40),
  summary: z.string().min(1).max(120),
  takeaway: z.string().min(1).max(100),
})

export const TrainingCardSchema = z.union([
  ScenarioCardSchema,
  ChoiceCardSchema,
  FeedbackCardSchema,
  PrincipleCardSchema,
  PracticeCardSchema,
  CompletionCardSchema,
])

const expectedCardOrder = [
  'scenario',
  'choice',
  'feedback',
  'principle',
  'practice',
  'completion',
] as const

export const TrainingSessionSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sessionId: IdentifierSchema,
  contentVersion: z.number().int().positive(),
  title: z.string().min(1).max(50),
  objective: z.string().min(1).max(120),
  skill: IdentifierSchema,
  difficulty: z.enum(['L1', 'L2', 'L3', 'L4']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  estimatedMinutes: z.number().int().min(1).max(10),
  cards: z.array(TrainingCardSchema).length(expectedCardOrder.length),
  reviewVariants: z.array(ReviewVariantSchema).max(5).default([]),
}).superRefine((session, context) => {
  const cardIds = new Set(session.cards.map((card) => card.id))
  if (cardIds.size !== session.cards.length) {
    context.addIssue({
      code: 'custom',
      message: '卡片 ID 不能重复',
      path: ['cards'],
    })
  }

  expectedCardOrder.forEach((type, index) => {
    if (session.cards[index]?.type !== type) {
      context.addIssue({
        code: 'custom',
        message: `第 ${index + 1} 张卡片必须是 ${type}`,
        path: ['cards', index, 'type'],
      })
    }
  })
  const variantIds = new Set<string>()
  const originalChoice = session.cards.find((card) => card.type === 'choice')
  session.reviewVariants.forEach((variant, index) => {
    if (variantIds.has(variant.variantId)) {
      context.addIssue({ code: 'custom', message: '复习变体 ID 不能重复', path: ['reviewVariants', index, 'variantId'] })
    }
    variantIds.add(variant.variantId)
    if (originalChoice && variant.prompt === originalChoice.prompt
      && JSON.stringify(variant.options.map((option) => option.text)) === JSON.stringify(originalChoice.options.map((option) => option.text))) {
      context.addIssue({ code: 'custom', message: '复习变体不能与原题完全相同', path: ['reviewVariants', index] })
    }
  })
})

export const TrainingCatalogSchema = z.object({
  schemaVersion: z.literal('1.0'),
  catalogId: IdentifierSchema,
  contentVersion: z.number().int().positive(),
  title: z.string().min(1).max(50),
  skill: IdentifierSchema,
  description: z.string().min(1).max(160),
  sessionIds: z.array(IdentifierSchema).min(1),
}).superRefine((catalog, context) => {
  const sessionIds = new Set(catalog.sessionIds)
  if (sessionIds.size !== catalog.sessionIds.length) {
    context.addIssue({
      code: 'custom',
      message: '训练目录中的 sessionId 不能重复',
      path: ['sessionIds'],
    })
  }
})

export const TrainingLibrarySchema = z.object({
  schemaVersion: z.literal('1.0'),
  libraryId: IdentifierSchema,
  contentVersion: z.number().int().positive(),
  title: z.string().min(1).max(50),
  description: z.string().min(1).max(200),
  catalogIds: z.array(IdentifierSchema).min(1),
}).superRefine((library, context) => {
  const catalogIds = new Set(library.catalogIds)
  if (catalogIds.size !== library.catalogIds.length) {
    context.addIssue({
      code: 'custom',
      message: '课程库中的 catalogId 不能重复',
      path: ['catalogIds'],
    })
  }
})

export const TrainingContentBundleSchema = z.object({
  releaseVersion: z.number().int().positive(),
  library: TrainingLibrarySchema,
  catalogs: z.record(IdentifierSchema, TrainingCatalogSchema),
  sessions: z.record(IdentifierSchema, TrainingSessionSchema),
}).superRefine((bundle, context) => {
  bundle.library.catalogIds.forEach((catalogId) => {
    const catalog = bundle.catalogs[catalogId]
    if (!catalog || catalog.catalogId !== catalogId) {
      context.addIssue({
        code: 'custom',
        message: '课程库引用的章节不存在或 ID 不一致',
        path: ['catalogs', catalogId],
      })
      return
    }

    catalog.sessionIds.forEach((sessionId) => {
      const session = bundle.sessions[sessionId]
      if (!session || session.sessionId !== sessionId) {
        context.addIssue({
          code: 'custom',
          message: '章节引用的训练不存在或 ID 不一致',
          path: ['sessions', sessionId],
        })
      } else if (session.skill !== catalog.skill) {
        context.addIssue({
          code: 'custom',
          message: '训练技能与所属章节不一致',
          path: ['sessions', sessionId, 'skill'],
        })
      }
    })
  })
})

export type TrainingOptionRating = z.infer<typeof TrainingOptionRatingSchema>
export type TrainingOption = z.infer<typeof TrainingOptionSchema>
export type ReviewVariant = z.infer<typeof ReviewVariantSchema>
export type ScenarioCard = z.infer<typeof ScenarioCardSchema>
export type ChoiceCard = z.infer<typeof ChoiceCardSchema>
export type FeedbackCard = z.infer<typeof FeedbackCardSchema>
export type PrincipleCard = z.infer<typeof PrincipleCardSchema>
export type PracticeDimension = z.infer<typeof PracticeDimensionSchema>
export type PracticeCard = z.infer<typeof PracticeCardSchema>
export type CompletionCard = z.infer<typeof CompletionCardSchema>
export type TrainingCard = z.infer<typeof TrainingCardSchema>
export type TrainingSession = z.infer<typeof TrainingSessionSchema>
export type TrainingCatalog = z.infer<typeof TrainingCatalogSchema>
export type TrainingLibrary = z.infer<typeof TrainingLibrarySchema>
export type TrainingContentBundle = z.infer<typeof TrainingContentBundleSchema>
