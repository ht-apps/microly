import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { createTrainingCompletedEvent } from './activity-state'
import {
  LEARNING_ACTIVITY_STORAGE_KEY,
  parseLearningActivity,
  recordLearningActivity,
} from './activity-storage'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
  },
}))

const firstSession = trainingContent.sessions[0]
if (!firstSession) throw new Error('缺少活动存储测试训练内容')

describe('learning activity storage', () => {
  beforeEach(() => mocks.storage.clear())

  it('逐项过滤损坏、重复和未知训练事件', () => {
    const event = createTrainingCompletedEvent(
      firstSession.sessionId,
      '2026-07-22T08:00:00.000Z',
    )
    const result = parseLearningActivity([
      event,
      event,
      { ...event, eventId: 'broken' },
      { ...event, localDateKey: '2026-07-21' },
      {
        ...event,
        sessionId: 'unknown-session',
        eventId: `training_completed:unknown-session:${event.occurredAt}`,
      },
    ], trainingContent.sessions)

    expect(result.events).toEqual([event])
    expect(result.recoveredFromInvalid).toBe(true)
  })

  it('重复记录同一事件不会重复写入', () => {
    const event = createTrainingCompletedEvent(
      firstSession.sessionId,
      '2026-07-22T08:00:00.000Z',
    )
    recordLearningActivity(trainingContent.sessions, event)
    const repeated = recordLearningActivity(trainingContent.sessions, event)

    expect(repeated.changed).toBe(false)
    expect(mocks.storage.get(LEARNING_ACTIVITY_STORAGE_KEY)).toEqual([event])
  })

})
