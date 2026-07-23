import type { TrainingSession } from '@microly/content-schema'

import type { ReviewItem } from '../review/review-state'
import type { TrainingProgress } from '../training/training-state'

export type LearningActivityEvent =
  | {
      eventId: string
      type: 'training_completed'
      occurredAt: string
      localDateKey: string
      sessionId: string
    }
  | {
      eventId: string
      type: 'due_review_answered'
      occurredAt: string
      localDateKey: string
      sessionId: string
      reviewId: string
    }

export interface LearningWeekDay {
  dateKey: string
  label: string
  isToday: boolean
  isFuture: boolean
  isEffective: boolean
  trainingCount: number
  dueReviewCount: number
}

export interface LearningActivitySummary {
  todayTrainingCompleted: boolean
  todayEffective: boolean
  todayCompletedSessionId: string | null
  weekEffectiveDayCount: number
  currentStreak: number
  weekDays: LearningWeekDay[]
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function toLocalDateKey(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromLocalKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export function addLocalDays(dateKey: string, days: number) {
  const date = dateFromLocalKey(dateKey)
  date.setDate(date.getDate() + days)
  return toLocalDateKey(date)
}

function startOfLocalWeek(dateKey: string) {
  const date = dateFromLocalKey(dateKey)
  const weekday = date.getDay()
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1
  date.setDate(date.getDate() - daysFromMonday)
  return toLocalDateKey(date)
}

function createEventId(
  type: LearningActivityEvent['type'],
  sourceId: string,
  occurredAt: string,
) {
  return `${type}:${sourceId}:${occurredAt}`
}

export function createTrainingCompletedEvent(
  sessionId: string,
  occurredAt: string,
): LearningActivityEvent {
  return {
    eventId: createEventId('training_completed', sessionId, occurredAt),
    type: 'training_completed',
    occurredAt,
    localDateKey: toLocalDateKey(occurredAt),
    sessionId,
  }
}

export function createDueReviewAnsweredEvent(
  item: Pick<ReviewItem, 'dueAt' | 'reviewId' | 'sessionId'>,
  answeredAt: string,
): LearningActivityEvent | null {
  if (Date.parse(item.dueAt) > Date.parse(answeredAt)) return null

  return {
    eventId: createEventId('due_review_answered', item.reviewId, answeredAt),
    type: 'due_review_answered',
    occurredAt: answeredAt,
    localDateKey: toLocalDateKey(answeredAt),
    sessionId: item.sessionId,
    reviewId: item.reviewId,
  }
}

export function mergeLearningActivityEvent(
  events: LearningActivityEvent[],
  event: LearningActivityEvent,
) {
  if (events.some((item) => item.eventId === event.eventId)) return events
  return [...events, event].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  )
}

export function backfillTrainingActivity(
  events: LearningActivityEvent[],
  sessions: TrainingSession[],
  progressBySessionId: Record<string, TrainingProgress>,
) {
  let nextEvents = events
  sessions.forEach((session) => {
    const progress = progressBySessionId[session.sessionId]
    if (progress?.status !== 'completed' || !progress.completedAt) return
    nextEvents = mergeLearningActivityEvent(
      nextEvents,
      createTrainingCompletedEvent(session.sessionId, progress.completedAt),
    )
  })
  return {
    events: nextEvents,
    changed: nextEvents !== events,
  }
}

function summarizeDate(events: LearningActivityEvent[], dateKey: string) {
  const dateEvents = events.filter((event) => event.localDateKey === dateKey)
  const trainingIds = new Set(
    dateEvents
      .filter((event) => event.type === 'training_completed')
      .map((event) => event.sessionId),
  )
  const dueReviewCount = dateEvents.filter(
    (event) => event.type === 'due_review_answered',
  ).length

  return {
    trainingCount: trainingIds.size,
    dueReviewCount,
    isEffective: trainingIds.size > 0 || dueReviewCount >= 2,
  }
}

export function createLearningActivitySummary(
  events: LearningActivityEvent[],
  now = new Date().toISOString(),
): LearningActivitySummary {
  const todayKey = toLocalDateKey(now)
  const weekStartKey = startOfLocalWeek(todayKey)
  const weekDays = WEEK_LABELS.map((label, index): LearningWeekDay => {
    const dateKey = addLocalDays(weekStartKey, index)
    const summary = summarizeDate(events, dateKey)
    return {
      dateKey,
      label,
      isToday: dateKey === todayKey,
      isFuture: dateKey > todayKey,
      isEffective: summary.isEffective,
      trainingCount: summary.trainingCount,
      dueReviewCount: summary.dueReviewCount,
    }
  })
  const todayEvents = events
    .filter((event) => (
      event.type === 'training_completed' && event.localDateKey === todayKey
    ))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
  const today = summarizeDate(events, todayKey)

  let streakDateKey = today.isEffective ? todayKey : addLocalDays(todayKey, -1)
  let currentStreak = 0
  while (summarizeDate(events, streakDateKey).isEffective) {
    currentStreak += 1
    streakDateKey = addLocalDays(streakDateKey, -1)
  }

  return {
    todayTrainingCompleted: today.trainingCount > 0,
    todayEffective: today.isEffective,
    todayCompletedSessionId:
      todayEvents[todayEvents.length - 1]?.sessionId ?? null,
    weekEffectiveDayCount: weekDays.filter((day) => day.isEffective).length,
    currentStreak,
    weekDays,
  }
}
