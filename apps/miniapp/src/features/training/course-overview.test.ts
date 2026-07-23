import { describe, expect, it } from 'vitest'

import { trainingContent } from '../../data/training-content'
import {
  createInitialProgress,
  transitionTraining,
  type TrainingProgress,
} from './training-state'
import { createCourseOverview } from './course-overview'

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

describe('course overview', () => {
  it('首次只解锁第一组训练和第一章', () => {
    const overview = createCourseOverview(
      trainingContent.chapters,
      progressMap(),
    )

    expect(overview.items[0]?.status).toBe('not_started')
    expect(overview.items.slice(1).every((item) => item.status === 'locked')).toBe(true)
    expect(overview.chapters.map((chapter) => chapter.status)).toEqual([
      'not_started',
      'locked',
      'locked',
      'locked',
    ])
    expect(overview.activeItem?.sessionId).toBe('boundary-decline-001')
  })

  it('优先恢复任意章节中进行中的训练', () => {
    const progresses = progressMap()
    const reporting = trainingContent.sessions.find(
      (session) => session.sessionId === 'report-risk-005',
    )
    if (!reporting) throw new Error('缺少汇报训练')
    progresses[reporting.sessionId] = transitionTraining(
      progresses[reporting.sessionId],
      reporting,
      { type: 'START' },
      timestamp,
    )

    const overview = createCourseOverview(trainingContent.chapters, progresses)

    expect(overview.activeItem?.sessionId).toBe(reporting.sessionId)
    expect(overview.activeChapter?.catalogId).toBe('clear-reporting')
  })

  it('完成现有三组后推进到清晰汇报首组', () => {
    const progresses = progressMap()
    trainingContent.sessions.slice(0, 3).forEach((session) => {
      progresses[session.sessionId] = markCompleted(progresses[session.sessionId])
    })

    const overview = createCourseOverview(trainingContent.chapters, progresses)

    expect(overview.chapters[0].status).toBe('completed')
    expect(overview.chapters[1].status).toBe('not_started')
    expect(overview.activeItem?.sessionId).toBe('report-conclusion-004')
  })

  it('不可用训练和章节不会阻塞后续有效内容', () => {
    const progresses = progressMap()
    const chapters = trainingContent.chapters.map((chapter, chapterIndex) => {
      if (chapterIndex === 0) {
        return {
          ...chapter,
          entries: chapter.entries.map((entry) => ({
            ...entry,
            session: null,
            error: '内容损坏',
          })),
        }
      }
      return chapterIndex === 1
        ? { ...chapter, catalog: null, entries: [], sessions: [], error: '章节损坏' }
        : chapter
    })

    const overview = createCourseOverview(chapters, progresses)

    expect(overview.chapters[0].status).toBe('unavailable')
    expect(overview.chapters[1].status).toBe('unavailable')
    expect(overview.activeItem?.sessionId).toBe('disagree-goal-007')
  })

  it('十组全部完成后进入课程完成状态', () => {
    const progresses = progressMap()
    trainingContent.sessions.forEach((session) => {
      progresses[session.sessionId] = markCompleted(progresses[session.sessionId])
    })

    const overview = createCourseOverview(trainingContent.chapters, progresses)

    expect(overview.allCompleted).toBe(true)
    expect(overview.activeItem).toBeNull()
    expect(overview.completedCount).toBe(10)
    expect(overview.chapters.every((chapter) => chapter.status === 'completed')).toBe(true)
  })
})
