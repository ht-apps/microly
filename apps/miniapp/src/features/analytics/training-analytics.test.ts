import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { createInitialProgress, transitionTraining } from '../training/training-state'
import {
  beginActiveTraining,
  finishActiveTraining,
  pauseActiveTraining,
  trackTrainingStart,
} from './training-analytics'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  trackEvent: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
  },
}))

vi.mock('./analytics-client', () => ({
  trackEvent: mocks.trackEvent,
}))

const session = trainingContent.sessions[0]

if (!session) throw new Error('测试需要至少一组合法训练')

describe('training analytics', () => {
  beforeEach(() => {
    mocks.storage.clear()
    mocks.trackEvent.mockReset()
  })

  it('同一次尝试从多个入口触发时只记录一次开始事件', () => {
    const progress = transitionTraining(createInitialProgress(session), session, { type: 'START' })

    expect(trackTrainingStart(session, progress, 'today')).toBe(true)
    expect(trackTrainingStart(session, progress, 'direct')).toBe(false)
    expect(mocks.trackEvent).toHaveBeenCalledTimes(1)
    expect(mocks.trackEvent).toHaveBeenCalledWith('training_start', expect.objectContaining({
      attemptId: progress.attemptId,
      sessionId: session.sessionId,
      entry: 'today',
    }))
  })

  it('仅累计前台区间，并限制异常单段时长', () => {
    beginActiveTraining('attempt-1', 1_000)
    expect(pauseActiveTraining('attempt-1', 31_000)).toBe(30_000)

    beginActiveTraining('attempt-1', 40_000)
    expect(pauseActiveTraining('attempt-1', 40_000 + 15 * 60_000)).toBe(630_000)
  })

  it('完成后返回累计活跃时长并清理计时状态', () => {
    beginActiveTraining('attempt-2', 10_000)
    expect(finishActiveTraining('attempt-2', 25_000)).toBe(15_000)
    expect(pauseActiveTraining('attempt-2', 30_000)).toBe(0)
  })
})
