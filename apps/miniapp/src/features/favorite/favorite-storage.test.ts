import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trainingContent } from '../../data/training-content'
import { addFavorite } from './favorite-state'
import {
  FAVORITE_STORAGE_KEY,
  readFavoriteQueue,
  setSessionFavorite,
  syncFavoriteQueue,
} from './favorite-storage'

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
if (!session) throw new Error('缺少收藏测试内容')

describe('favorite storage', () => {
  beforeEach(() => mocks.storage.clear())

  it('Storage 损坏时恢复为空列表', () => {
    mocks.storage.set(FAVORITE_STORAGE_KEY, { invalid: true })
    const result = readFavoriteQueue(trainingContent.sessions)
    expect(result.items).toEqual([])
    expect(result.recoveredFromInvalid).toBe(true)
  })

  it('收藏与取消收藏写入同一个版本化键', () => {
    const added = setSessionFavorite(
      trainingContent.sessions,
      session,
      true,
      '2026-07-20T08:00:00.000Z',
    )
    expect(added.writeFailed).toBe(false)
    expect(mocks.storage.get(FAVORITE_STORAGE_KEY)).toHaveLength(1)

    setSessionFavorite(trainingContent.sessions, session, true)
    expect(mocks.storage.get(FAVORITE_STORAGE_KEY)).toHaveLength(1)

    const removed = setSessionFavorite(trainingContent.sessions, session, false)
    expect(removed.writeFailed).toBe(false)
    expect(mocks.storage.get(FAVORITE_STORAGE_KEY)).toEqual([])
  })

  it('读取时清理无效条目并保留有效收藏', () => {
    const valid = addFavorite([], session, '2026-07-20T08:00:00.000Z').item
    mocks.storage.set(FAVORITE_STORAGE_KEY, [valid, { broken: true }])

    const result = readFavoriteQueue(trainingContent.sessions)
    expect(result.items).toHaveLength(1)
    expect(result.recoveredFromInvalid).toBe(true)

    const synced = syncFavoriteQueue(trainingContent.sessions)
    expect(synced.writeFailed).toBe(false)
    expect(mocks.storage.get(FAVORITE_STORAGE_KEY)).toEqual([valid])
  })
})
