import { describe, expect, it } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { createInitialProgress, type TrainingProgress } from '../training/training-state'
import {
  backfillTrainingActivity,
  createDueReviewAnsweredEvent,
  createLearningActivitySummary,
  createTrainingCompletedEvent,
  mergeLearningActivityEvent,
  toLocalDateKey,
} from './activity-state'

function localTime(year: number, month: number, day: number, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

const firstSession = trainingContent.sessions[0]
if (!firstSession) throw new Error('缺少活动测试训练内容')

describe('learning activity state', () => {
  it('按事件 ID 去重并按发生时间排序', () => {
    const later = createTrainingCompletedEvent(
      firstSession.sessionId,
      localTime(2026, 7, 22, 14),
    )
    const earlier = createTrainingCompletedEvent(
      firstSession.sessionId,
      localTime(2026, 7, 21, 14),
    )
    const events = mergeLearningActivityEvent(
      mergeLearningActivityEvent([later], earlier),
      earlier,
    )

    expect(events.map((event) => event.eventId)).toEqual([
      earlier.eventId,
      later.eventId,
    ])
  })

  it('只为实际到期的复习创建活动事件', () => {
    const answeredAt = localTime(2026, 7, 22)
    const due = createDueReviewAnsweredEvent({
      sessionId: firstSession.sessionId,
      reviewId: `${firstSession.sessionId}:choice`,
      dueAt: localTime(2026, 7, 21),
    }, answeredAt)
    const early = createDueReviewAnsweredEvent({
      sessionId: firstSession.sessionId,
      reviewId: `${firstSession.sessionId}:choice`,
      dueAt: localTime(2026, 7, 23),
    }, answeredAt)

    expect(due?.type).toBe('due_review_answered')
    expect(early).toBeNull()
  })

  it('完成训练或两道到期复习形成有效学习日', () => {
    const monday = localTime(2026, 7, 20)
    const tuesday = localTime(2026, 7, 21)
    const wednesday = localTime(2026, 7, 22)
    const training = createTrainingCompletedEvent(firstSession.sessionId, monday)
    const reviewBase = {
      sessionId: firstSession.sessionId,
      reviewId: `${firstSession.sessionId}:choice`,
      dueAt: localTime(2026, 7, 19),
    }
    const firstReview = createDueReviewAnsweredEvent(reviewBase, tuesday)
    const secondReview = createDueReviewAnsweredEvent(
      { ...reviewBase, reviewId: `${firstSession.sessionId}:choice-2` },
      localTime(2026, 7, 21, 13),
    )
    const singleReview = createDueReviewAnsweredEvent(
      { ...reviewBase, reviewId: `${firstSession.sessionId}:choice-3` },
      wednesday,
    )
    const events = [training, firstReview, secondReview, singleReview].filter(
      (event): event is NonNullable<typeof event> => Boolean(event),
    )
    const summary = createLearningActivitySummary(events, wednesday)

    expect(summary.weekDays.map((day) => day.isEffective)).toEqual([
      true, true, false, false, false, false, false,
    ])
    expect(summary.weekEffectiveDayCount).toBe(2)
    expect(summary.currentStreak).toBe(2)
    expect(summary.todayEffective).toBe(false)
  })

  it('同一天重练只形成一个学习日并保留最近完成训练', () => {
    const first = createTrainingCompletedEvent(
      firstSession.sessionId,
      localTime(2026, 7, 22, 9),
    )
    const secondSession = trainingContent.sessions[1]
    if (!secondSession) throw new Error('缺少第二组活动测试训练内容')
    const second = createTrainingCompletedEvent(
      secondSession.sessionId,
      localTime(2026, 7, 22, 18),
    )
    const repeated = createTrainingCompletedEvent(
      firstSession.sessionId,
      localTime(2026, 7, 22, 20),
    )
    const summary = createLearningActivitySummary(
      [first, second, repeated],
      localTime(2026, 7, 22, 21),
    )

    expect(summary.todayTrainingCompleted).toBe(true)
    expect(summary.todayEffective).toBe(true)
    expect(summary.weekEffectiveDayCount).toBe(1)
    expect(summary.todayCompletedSessionId).toBe(firstSession.sessionId)
  })

  it('今天未学习时延续昨天的连续天数，断档后归零', () => {
    const monday = createTrainingCompletedEvent(
      firstSession.sessionId,
      localTime(2026, 7, 20),
    )
    const tuesday = createTrainingCompletedEvent(
      firstSession.sessionId,
      localTime(2026, 7, 21),
    )

    expect(createLearningActivitySummary(
      [monday, tuesday],
      localTime(2026, 7, 22),
    ).currentStreak).toBe(2)
    expect(createLearningActivitySummary(
      [monday, tuesday],
      localTime(2026, 7, 23),
    ).currentStreak).toBe(0)
  })

  it('周进度以周一开始并正确跨月', () => {
    const summary = createLearningActivitySummary([], localTime(2026, 8, 2))
    expect(summary.weekDays.map((day) => day.dateKey)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ])
    expect(summary.weekDays.at(-1)?.isToday).toBe(true)
  })

  it('从已完成训练幂等补建历史事件', () => {
    const completedAt = localTime(2026, 7, 22)
    const progress: TrainingProgress = {
      ...createInitialProgress(firstSession, completedAt),
      status: 'completed',
      currentCardIndex: firstSession.cards.length - 1,
      completedAt,
    }
    const first = backfillTrainingActivity(
      [],
      [firstSession],
      { [firstSession.sessionId]: progress },
    )
    const second = backfillTrainingActivity(
      first.events,
      [firstSession],
      { [firstSession.sessionId]: progress },
    )

    expect(first.changed).toBe(true)
    expect(first.events).toHaveLength(1)
    expect(second.changed).toBe(false)
    expect(toLocalDateKey(completedAt)).toBe('2026-07-22')
  })
})
