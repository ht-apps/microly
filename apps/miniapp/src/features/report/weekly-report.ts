import type { AiEvaluation } from '@microly/api-contract'
import type { TrainingSession } from '@microly/content-schema'

import type { LearningActivityEvent } from '../activity/activity-state'
import { addLocalDays, startOfLocalWeek, toLocalDateKey } from '../activity/activity-state'

export interface WeeklyReport {
  weekStart: string
  weekEnd: string
  effectiveDays: number
  trainingCount: number
  coveredSessionCount: number
  reviewCount: number
  reviewCorrectRate: number | null
  topSkill: string | null
  stableDimension: string | null
  focusDimension: string | null
  nextAction: { type: 'review' | 'training'; label: string; sessionId?: string } | null
}

export function weekStartForOffset(offset: number, now = new Date()) {
  return addLocalDays(startOfLocalWeek(toLocalDateKey(now)), -7 * offset)
}

export function buildWeeklyReport(input: {
  weekStart: string
  events: LearningActivityEvent[]
  evaluations: AiEvaluation[]
  sessions: TrainingSession[]
  dueReviewCount: number
  nextSessionId?: string | null
}): WeeklyReport {
  const weekEnd = addLocalDays(input.weekStart, 6)
  const events = input.events.filter((event) => event.localDateKey >= input.weekStart && event.localDateKey <= weekEnd)
  const sessionMap = new Map(input.sessions.map((session) => [session.sessionId, session]))
  const training = events.filter((event) => event.type === 'training_completed')
  const reviews = events.filter((event) => event.type === 'due_review_answered')
  const byDate = new Map<string, { training: number; reviews: number }>()
  events.forEach((event) => {
    const current = byDate.get(event.localDateKey) ?? { training: 0, reviews: 0 }
    if (event.type === 'training_completed') current.training += 1
    else current.reviews += 1
    byDate.set(event.localDateKey, current)
  })
  const skillCounts = new Map<string, number>()
  events.forEach((event) => {
    const skill = sessionMap.get(event.sessionId)?.skill
    if (skill) skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1)
  })
  const dimensionCounts = new Map<string, { title: string; met: number; partial: number; missing: number; sessionId: string }>()
  input.evaluations.filter((item) => {
    const key = toLocalDateKey(item.createdAt)
    return key >= input.weekStart && key <= weekEnd && item.result?.safety.allowed
  }).forEach((item) => {
    const card = sessionMap.get(item.sessionId)?.cards.find((entry) => entry.type === 'practice')
    item.result?.dimensions.forEach((dimension) => {
      const title = card?.dimensions.find((entry) => entry.id === dimension.dimensionId)?.title ?? dimension.dimensionId
      const key = `${item.sessionId}:${dimension.dimensionId}`
      const current = dimensionCounts.get(key) ?? { title, met: 0, partial: 0, missing: 0, sessionId: item.sessionId }
      current[dimension.level] += 1
      dimensionCounts.set(key, current)
    })
  })
  const measurableReviews = reviews.filter((event) => typeof event.isCorrect === 'boolean')
  const stable = [...dimensionCounts.values()].filter((item) => item.met > item.partial + item.missing).sort((a, b) => b.met - a.met || a.title.localeCompare(b.title))[0]
  const focus = [...dimensionCounts.values()].filter((item) => item.missing * 2 + item.partial > item.met).sort((a, b) => (b.missing * 2 + b.partial) - (a.missing * 2 + a.partial) || a.title.localeCompare(b.title))[0]
  const topSkill = [...skillCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
  const nextSessionId = focus?.sessionId ?? input.nextSessionId ?? null
  const nextAction = input.dueReviewCount > 0
    ? { type: 'review' as const, label: `先完成 ${input.dueReviewCount} 道到期复习` }
    : nextSessionId
      ? { type: 'training' as const, sessionId: nextSessionId, label: focus ? `再练一次“${focus.title}”` : '继续下一组训练' }
      : null
  return {
    weekStart: input.weekStart, weekEnd,
    effectiveDays: [...byDate.values()].filter((day) => day.training > 0 || day.reviews >= 2).length,
    trainingCount: training.length,
    coveredSessionCount: new Set(training.map((event) => event.sessionId)).size,
    reviewCount: reviews.length,
    reviewCorrectRate: measurableReviews.length ? measurableReviews.filter((event) => event.isCorrect).length / measurableReviews.length : null,
    topSkill, stableDimension: stable?.title ?? null, focusDimension: focus?.title ?? null, nextAction,
  }
}
