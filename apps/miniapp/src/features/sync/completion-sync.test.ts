import { trainingContent } from '../../data/training-content'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  request: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
    removeStorageSync: (key: string) => mocks.storage.delete(key),
  },
}))

vi.mock('../network/guest-auth', () => ({
  authorizedRequest: mocks.request,
}))

import { createInitialProgress } from '../training/training-state'
import {
  COMPLETION_OUTBOX_STORAGE_KEY,
  completionFromProgress,
  enqueueTrainingCompletion,
  flushCompletionOutbox,
  parseCompletionOutbox,
} from './completion-sync'

const session = trainingContent.sessions[0]
if (!session) throw new Error('缺少训练测试内容')

function completedProgress() {
  return {
    ...createInitialProgress(session, '2026-07-23T10:00:00.000Z'),
    status: 'completed' as const,
    currentCardIndex: session.cards.length - 1,
    selectedOptionId: session.cards.find((card) => card.type === 'choice')?.options[0]?.id ?? null,
    choiceConfirmed: true,
    practiceEvaluation: [],
    startedAt: '2026-07-23T10:00:00.000Z',
    completedAt: '2026-07-23T10:03:00.000Z',
    updatedAt: '2026-07-23T10:03:00.000Z',
  }
}

describe('completion outbox', () => {
  beforeEach(() => {
    mocks.storage.clear()
    mocks.request.mockReset()
  })

  it('为同一完成记录生成稳定 ID 并去重', () => {
    const progress = completedProgress()
    expect(completionFromProgress(progress)?.syncId).toBe(completionFromProgress(progress)?.syncId)
    enqueueTrainingCompletion(progress)
    enqueueTrainingCompletion(progress)
    expect(parseCompletionOutbox(mocks.storage.get(COMPLETION_OUTBOX_STORAGE_KEY))).toHaveLength(1)
  })

  it('失败时保留待同步项，成功时移除', async () => {
    enqueueTrainingCompletion(completedProgress())
    mocks.request.mockResolvedValueOnce(null)
    await expect(flushCompletionOutbox()).resolves.toBe(0)
    expect(parseCompletionOutbox(mocks.storage.get(COMPLETION_OUTBOX_STORAGE_KEY))).toHaveLength(1)

    const completion = completionFromProgress(completedProgress())
    mocks.request.mockResolvedValueOnce({ statusCode: 200, data: { data: completion } })
    await expect(flushCompletionOutbox()).resolves.toBe(1)
    expect(parseCompletionOutbox(mocks.storage.get(COMPLETION_OUTBOX_STORAGE_KEY))).toHaveLength(0)
  })
})
