import { z } from 'zod'

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
})

export type TrainingOptionRating = z.infer<typeof TrainingOptionRatingSchema>
export type TrainingOption = z.infer<typeof TrainingOptionSchema>
export type ScenarioCard = z.infer<typeof ScenarioCardSchema>
export type ChoiceCard = z.infer<typeof ChoiceCardSchema>
export type FeedbackCard = z.infer<typeof FeedbackCardSchema>
export type PrincipleCard = z.infer<typeof PrincipleCardSchema>
export type PracticeDimension = z.infer<typeof PracticeDimensionSchema>
export type PracticeCard = z.infer<typeof PracticeCardSchema>
export type CompletionCard = z.infer<typeof CompletionCardSchema>
export type TrainingCard = z.infer<typeof TrainingCardSchema>
export type TrainingSession = z.infer<typeof TrainingSessionSchema>
