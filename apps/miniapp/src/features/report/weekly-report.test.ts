import { describe, expect, it } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { createDueReviewAnsweredEvent, createTrainingCompletedEvent } from '../activity/activity-state'
import { buildWeeklyReport, weekStartForOffset } from './weekly-report'

const session = trainingContent.sessions[0]
if (!session) throw new Error('缺少周报测试训练')

describe('weekly report', () => {
  it('以周一开始并支持最近八周偏移', () => {
    const sunday = new Date(2026, 7, 2, 12)
    expect(weekStartForOffset(0, sunday)).toBe('2026-07-27')
    expect(weekStartForOffset(7, sunday)).toBe('2026-06-08')
  })

  it('汇总训练、复习正确率并优先建议到期复习', () => {
    const completedAt = new Date(2026, 6, 20, 10).toISOString()
    const answeredAt = new Date(2026, 6, 21, 10).toISOString()
    const review = createDueReviewAnsweredEvent({ sessionId: session.sessionId, reviewId: `${session.sessionId}:choice`, dueAt: new Date(2026, 6, 20).toISOString() }, answeredAt, {
      variantId: 'variant-one', selectedOptionRating: 'recommended', isCorrect: true,
    })
    const report = buildWeeklyReport({
      weekStart: '2026-07-20', events: [createTrainingCompletedEvent(session.sessionId, completedAt), review!],
      evaluations: [], sessions: trainingContent.sessions, dueReviewCount: 2, nextSessionId: session.sessionId,
    })
    expect(report.trainingCount).toBe(1)
    expect(report.reviewCorrectRate).toBe(1)
    expect(report.nextAction).toEqual({ type: 'review', label: '先完成 2 道到期复习' })
  })

  it('旧复习事件缺少正确性时不虚构正确率', () => {
    const answeredAt = new Date(2026, 6, 21, 10).toISOString()
    const review = createDueReviewAnsweredEvent({ sessionId: session.sessionId, reviewId: `${session.sessionId}:choice`, dueAt: new Date(2026, 6, 20).toISOString() }, answeredAt)
    const report = buildWeeklyReport({ weekStart: '2026-07-20', events: [review!], evaluations: [], sessions: trainingContent.sessions, dueReviewCount: 0 })
    expect(report.reviewCorrectRate).toBeNull()
  })
})
