import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { createInitialProgress, type TrainingProgress } from '../training/training-state'
import { findChoiceCard, upsertReviewFromTraining } from './review-state'
import {
  REVIEW_STORAGE_KEY,
  parseReviewQueue,
  readReviewQueue,
  syncReviewQueueFromProgress,
  writeReviewQueue,
} from './review-storage'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
  },
}))

const session = trainingContent.sessions[0]
const choiceCard = session ? findChoiceCard(session) : null
const wrongOption = choiceCard?.options.find(
  (option) => option.rating === 'not_recommended',
)

if (!session || !wrongOption) throw new Error('缺少复习测试内容')

const completedProgress: TrainingProgress = {
  ...createInitialProgress(session, '2026-07-23T08:00:00.000Z'),
  status: 'completed',
  currentCardIndex: 5,
  selectedOptionId: wrongOption.id,
  choiceConfirmed: true,
  practiceEvaluation: [],
  startedAt: '2026-07-23T08:00:00.000Z',
  updatedAt: '2026-07-23T08:00:00.000Z',
  completedAt: '2026-07-23T08:00:00.000Z',
}

describe('review storage', () => {
  beforeEach(() => mocks.storage.clear())

  it('过滤损坏、未知训练和旧内容版本条目', () => {
    const valid = upsertReviewFromTraining(
      [],
      session,
      completedProgress,
    ).item
    const parsed = parseReviewQueue([
      valid,
      { ...valid, reviewId: 'unknown:choice', sessionId: 'unknown' },
      { ...valid, contentVersion: session.contentVersion + 1 },
      { broken: true },
    ], trainingContent.sessions)

    expect(parsed.items).toHaveLength(1)
    expect(parsed.recoveredFromInvalid).toBe(true)
  })

  it('Storage 损坏时安全恢复为空队列', () => {
    mocks.storage.set(REVIEW_STORAGE_KEY, { invalid: true })

    expect(readReviewQueue(trainingContent.sessions)).toEqual({
      items: [],
      recoveredFromInvalid: true,
    })
  })

  it('从历史完成记录补建并持久化复习项', () => {
    const synced = syncReviewQueueFromProgress(trainingContent.sessions, {
      [session.sessionId]: completedProgress,
    })

    expect(synced.items).toHaveLength(1)
    expect(synced.writeFailed).toBe(false)
    expect(mocks.storage.get(REVIEW_STORAGE_KEY)).toHaveLength(1)

    writeReviewQueue(synced.items)
    const repeated = syncReviewQueueFromProgress(trainingContent.sessions, {
      [session.sessionId]: completedProgress,
    })
    expect(repeated.items).toHaveLength(1)
  })
})
