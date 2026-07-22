import { describe, expect, it } from 'vitest'

import { trainingContent } from '../../data/training-content'
import {
  createInitialProgress,
  transitionTraining,
  type TrainingProgress,
} from './training-state'
import { createCourseOverview } from './training-scheduler'

const timestamp = '2026-07-22T12:00:00.000Z'

function progressMap() {
  return Object.fromEntries(trainingContent.sessions.map((session) => [
    session.sessionId,
    createInitialProgress(session, timestamp),
  ])) as Record<string, TrainingProgress>
}

function markCompleted(progress: TrainingProgress): TrainingProgress {
  return {
    ...progress,
    status: 'completed',
    currentCardIndex: 5,
    choiceConfirmed: true,
    selectedOptionId: 'test-option',
    practiceEvaluation: [],
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  }
}

describe('training scheduler', () => {
  it('首次只解锁第一组训练', () => {
    const overview = createCourseOverview(
      trainingContent.entries,
      progressMap(),
    )

    expect(overview.items.map((item) => item.status)).toEqual([
      'not_started',
      'locked',
      'locked',
    ])
    expect(overview.activeItem?.sessionId).toBe('boundary-decline-001')
  })

  it('优先恢复进行中的训练', () => {
    const progresses = progressMap()
    const second = trainingContent.sessions[1]
    if (!second) throw new Error('缺少第二组训练')
    progresses[second.sessionId] = transitionTraining(
      progresses[second.sessionId],
      second,
      { type: 'START' },
      timestamp,
    )

    const overview = createCourseOverview(trainingContent.entries, progresses)

    expect(overview.activeItem?.sessionId).toBe(second.sessionId)
    expect(overview.activeItem?.status).toBe('in_progress')
  })

  it('完成前一组后推进到下一组', () => {
    const progresses = progressMap()
    const first = trainingContent.sessions[0]
    if (!first) throw new Error('缺少第一组训练')
    progresses[first.sessionId] = markCompleted(progresses[first.sessionId])

    const overview = createCourseOverview(trainingContent.entries, progresses)

    expect(overview.completedCount).toBe(1)
    expect(overview.items[1].status).toBe('not_started')
    expect(overview.activeItem?.sessionId).toBe('boundary-priority-002')
  })

  it('不可用内容不会阻塞后续有效训练', () => {
    const progresses = progressMap()
    const first = trainingContent.sessions[0]
    if (!first) throw new Error('缺少第一组训练')
    progresses[first.sessionId] = markCompleted(progresses[first.sessionId])
    const entries = trainingContent.entries.map((entry, index) => index === 1
      ? { ...entry, session: null, error: '内容损坏' }
      : entry)

    const overview = createCourseOverview(entries, progresses)

    expect(overview.items[1].status).toBe('unavailable')
    expect(overview.items[2].status).toBe('not_started')
  })

  it('所有可用训练完成后进入章节完成状态', () => {
    const progresses = progressMap()
    trainingContent.sessions.forEach((session) => {
      progresses[session.sessionId] = markCompleted(
        progresses[session.sessionId],
      )
    })

    const overview = createCourseOverview(trainingContent.entries, progresses)

    expect(overview.allCompleted).toBe(true)
    expect(overview.activeItem).toBeNull()
    expect(overview.completedCount).toBe(3)
  })
})
