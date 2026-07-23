import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCompletedPreference } from './preference-state'
import {
  PREFERENCE_STORAGE_KEY,
  saveUserPreference,
  syncUserPreference,
} from './preference-storage'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  failWrites: false,
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      if (mocks.failWrites) throw new Error('storage unavailable')
      mocks.storage.set(key, value)
    },
  },
}))

const catalogIds = ['boundary-communication', 'clear-reporting']
const now = '2026-07-23T08:00:00.000Z'

describe('user preference storage', () => {
  beforeEach(() => {
    mocks.storage.clear()
    mocks.failWrites = false
  })

  it('保存后可以读取相同偏好', () => {
    saveUserPreference([catalogIds[1]], null, now)
    expect(syncUserPreference(catalogIds).preference?.selectedCatalogIds).toEqual([
      catalogIds[1],
    ])
  })

  it('内容更新后清理失效偏好并回写', () => {
    mocks.storage.set(
      PREFERENCE_STORAGE_KEY,
      createCompletedPreference(catalogIds, now),
    )
    const result = syncUserPreference([catalogIds[0]])
    expect(result.recoveredFromInvalid).toBe(true)
    expect(result.writeFailed).toBe(false)
    expect(result.preference?.selectedCatalogIds).toEqual([catalogIds[0]])
  })

  it('写入失败时仍返回可供页面继续使用的偏好', () => {
    mocks.failWrites = true
    const saved = saveUserPreference([catalogIds[0]], null, now)
    expect(saved.writeFailed).toBe(true)
    expect(saved.preference.selectedCatalogIds).toEqual([catalogIds[0]])
  })
})
