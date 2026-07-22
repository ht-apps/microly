import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { createInitialProgress } from './training-state'
import {
  clearTrainingProgress,
  getTrainingStorageKey,
  readTrainingProgress,
  writeTrainingProgress,
} from './training-storage'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
    removeStorageSync: (key: string) => mocks.storage.delete(key),
  },
}))

const [firstSession, secondSession] = trainingContent.sessions

if (!firstSession || !secondSession) {
  throw new Error('测试需要至少两组合法训练')
}

describe('training storage', () => {
  beforeEach(() => {
    mocks.storage.clear()
  })

  it('首组训练继续使用原有版本化存储键', () => {
    expect(getTrainingStorageKey(firstSession)).toBe(
      'microly:training:boundary-decline-001:v1',
    )
  })

  it('不同训练分别读写且互不覆盖', () => {
    const firstProgress = createInitialProgress(firstSession)
    const secondProgress = createInitialProgress(secondSession)

    writeTrainingProgress(firstProgress)
    writeTrainingProgress(secondProgress)

    expect(readTrainingProgress(firstSession).progress.sessionId).toBe(
      firstSession.sessionId,
    )
    expect(readTrainingProgress(secondSession).progress.sessionId).toBe(
      secondSession.sessionId,
    )
    expect(mocks.storage.size).toBe(2)
  })

  it('重练清理只移除指定训练', () => {
    writeTrainingProgress(createInitialProgress(firstSession))
    writeTrainingProgress(createInitialProgress(secondSession))

    clearTrainingProgress(firstSession)

    expect(mocks.storage.has(getTrainingStorageKey(firstSession))).toBe(false)
    expect(mocks.storage.has(getTrainingStorageKey(secondSession))).toBe(true)
  })
})
