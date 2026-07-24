import type {
  ChoiceCard,
  ReviewVariant,
  TrainingOption,
  TrainingSession,
} from '@microly/content-schema'

import type { TrainingProgress } from '../training/training-state'

export const REVIEW_INTERVALS = [1, 3, 7, 14] as const
export type ReviewIntervalDays = typeof REVIEW_INTERVALS[number]
export type ReviewResult = 'correct' | 'incorrect'

export interface ReviewItem {
  reviewId: string
  sessionId: string
  contentVersion: number
  sourceCardId: string
  lastSelectedOptionId: string
  dueAt: string
  intervalDays: ReviewIntervalDays
  consecutiveCorrect: number
  lastResult: ReviewResult
  createdAt: string
  updatedAt: string
  lastReviewedAt: string | null
  reviewCount: number
  lastVariantId: string | null
}

export interface ReviewMutation {
  items: ReviewItem[]
  item: ReviewItem | null
  changed: boolean
}

export interface ResolvedReviewItem {
  item: ReviewItem
  session: TrainingSession
  choiceCard: ChoiceCard
}

export interface ResolvedReviewQuestion {
  variantId: string | null
  title: string
  context: string
  question: string
  prompt: string
  options: TrainingOption[]
}

export interface ReviewOverview {
  dueItems: ResolvedReviewItem[]
  dueBatch: ResolvedReviewItem[]
  upcomingItems: ResolvedReviewItem[]
  nextDueAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export function createReviewId(sessionId: string) {
  return `${sessionId}:choice`
}

export function findChoiceCard(session: TrainingSession) {
  return session.cards.find((card): card is ChoiceCard => card.type === 'choice')
    ?? null
}

export function findTrainingOption(
  session: TrainingSession,
  optionId: string | null,
): TrainingOption | null {
  if (!optionId) return null
  return findChoiceCard(session)?.options.find((option) => option.id === optionId)
    ?? null
}

export function findReviewOption(session: TrainingSession, variantId: string | null, optionId: string | null) {
  if (!optionId) return null
  if (variantId) return session.reviewVariants.find((variant) => variant.variantId === variantId)?.options.find((option) => option.id === optionId) ?? null
  return findTrainingOption(session, optionId)
}

export function resolveReviewQuestion(entry: ResolvedReviewItem): ResolvedReviewQuestion {
  const { item, session, choiceCard } = entry
  const scenario = session.cards.find((card) => card.type === 'scenario')
  const useVariant = session.reviewVariants.length > 0 && item.reviewCount % 2 === 0
  const variant: ReviewVariant | undefined = useVariant
    ? session.reviewVariants[Math.floor(item.reviewCount / 2) % session.reviewVariants.length]
    : undefined
  return variant ? {
    variantId: variant.variantId,
    title: variant.title,
    context: variant.context,
    question: variant.question,
    prompt: variant.prompt,
    options: variant.options,
  } : {
    variantId: null,
    title: scenario?.title ?? session.title,
    context: scenario?.context ?? '',
    question: scenario?.question ?? choiceCard.prompt,
    prompt: choiceCard.prompt,
    options: choiceCard.options,
  }
}

export function addReviewDays(isoTime: string, days: number) {
  return new Date(Date.parse(isoTime) + days * DAY_MS).toISOString()
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function formatReviewDate(
  isoTime: string,
  now = new Date().toISOString(),
) {
  const date = new Date(isoTime)
  const current = new Date(now)
  const tomorrow = new Date(current)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (localDateKey(date) === localDateKey(current)) return '今天'
  if (localDateKey(date) === localDateKey(tomorrow)) return '明天'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function createReviewItem(
  session: TrainingSession,
  selectedOptionId: string,
  occurredAt: string,
): ReviewItem | null {
  const choiceCard = findChoiceCard(session)
  const option = findTrainingOption(session, selectedOptionId)
  if (!choiceCard || option?.rating !== 'not_recommended') {
    return null
  }

  return {
    reviewId: createReviewId(session.sessionId),
    sessionId: session.sessionId,
    contentVersion: session.contentVersion,
    sourceCardId: choiceCard.id,
    lastSelectedOptionId: selectedOptionId,
    dueAt: addReviewDays(occurredAt, 1),
    intervalDays: 1,
    consecutiveCorrect: 0,
    lastResult: 'incorrect',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    lastReviewedAt: null,
    reviewCount: 0,
    lastVariantId: null,
  }
}

export function upsertReviewFromTraining(
  items: ReviewItem[],
  session: TrainingSession,
  progress: TrainingProgress,
  occurredAt = progress.completedAt ?? new Date().toISOString(),
): ReviewMutation {
  if (progress.status !== 'completed' || !progress.completedAt) {
    return { items, item: null, changed: false }
  }

  const nextItem = createReviewItem(
    session,
    progress.selectedOptionId ?? '',
    occurredAt,
  )
  if (!nextItem) {
    return { items, item: null, changed: false }
  }

  const existingIndex = items.findIndex(
    (item) => item.reviewId === nextItem.reviewId,
  )
  if (existingIndex < 0) {
    return { items: [...items, nextItem], item: nextItem, changed: true }
  }

  const resetItem: ReviewItem = {
    ...nextItem,
    createdAt: items[existingIndex].createdAt,
  }
  const nextItems = [...items]
  nextItems[existingIndex] = resetItem
  return { items: nextItems, item: resetItem, changed: true }
}

function nextCorrectInterval(consecutiveCorrect: number): ReviewIntervalDays {
  if (consecutiveCorrect <= 1) return 3
  if (consecutiveCorrect === 2) return 7
  return 14
}

export function scheduleReviewAnswer(
  item: ReviewItem,
  session: TrainingSession,
  selectedOptionId: string,
  answeredAt = new Date().toISOString(),
  variantId: string | null = null,
) {
  const option = findReviewOption(session, variantId, selectedOptionId)
  if (!option) return null

  const isCorrect = option.rating === 'recommended'
  const consecutiveCorrect = isCorrect ? item.consecutiveCorrect + 1 : 0
  const intervalDays: ReviewIntervalDays = isCorrect
    ? nextCorrectInterval(consecutiveCorrect)
    : 1

  return {
    isCorrect,
    option,
    item: {
      ...item,
      lastSelectedOptionId: selectedOptionId,
      dueAt: addReviewDays(answeredAt, intervalDays),
      intervalDays,
      consecutiveCorrect,
      lastResult: isCorrect ? 'correct' as const : 'incorrect' as const,
      updatedAt: answeredAt,
      lastReviewedAt: answeredAt,
      reviewCount: item.reviewCount + 1,
      lastVariantId: variantId,
    },
  }
}

export function createReviewOverview(
  items: ReviewItem[],
  sessions: TrainingSession[],
  now = new Date().toISOString(),
): ReviewOverview {
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]))
  const resolved = items.flatMap((item): ResolvedReviewItem[] => {
    const session = sessionMap.get(item.sessionId)
    const choiceCard = session ? findChoiceCard(session) : null
    return session && choiceCard ? [{ item, session, choiceCard }] : []
  }).sort((left, right) => (
    Date.parse(left.item.dueAt) - Date.parse(right.item.dueAt)
    || Date.parse(left.item.createdAt) - Date.parse(right.item.createdAt)
  ))
  const nowTime = Date.parse(now)
  const dueItems = resolved.filter((entry) => Date.parse(entry.item.dueAt) <= nowTime)
  const upcomingItems = resolved.filter(
    (entry) => Date.parse(entry.item.dueAt) > nowTime,
  )

  return {
    dueItems,
    dueBatch: dueItems.slice(0, 5),
    upcomingItems,
    nextDueAt: resolved[0]?.item.dueAt ?? null,
  }
}
