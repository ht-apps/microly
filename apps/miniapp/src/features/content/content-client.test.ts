import {
  setTrainingContentBundle,
  remoteTrainingContentBundle,
  trainingContentBundle,
} from '@microly/training-content'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  request: vi.fn(),
  trigger: vi.fn(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key),
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
    request: mocks.request,
    eventCenter: { trigger: mocks.trigger, on: vi.fn(), off: vi.fn() },
  },
}))

import {
  CONTENT_CACHE_STORAGE_KEY,
  initializeTrainingContentFromCache,
  parseContentCache,
  refreshTrainingContent,
} from './content-client'

const checksum = 'a'.repeat(64)

describe('remote training content', () => {
  beforeEach(() => {
    mocks.storage.clear()
    mocks.request.mockReset()
    mocks.trigger.mockReset()
    process.env.TARO_APP_API_BASE_URL = 'http://127.0.0.1:3000'
  })

  afterEach(() => {
    setTrainingContentBundle(trainingContentBundle)
  })

  it('拒绝损坏缓存并保留内置内容', () => {
    expect(parseContentCache({ bundle: {}, checksum })).toBeNull()
    mocks.storage.set(CONTENT_CACHE_STORAGE_KEY, { bundle: {}, checksum })
    expect(initializeTrainingContentFromCache()).toBeNull()
  })

  it('读取经过校验的完整缓存', () => {
    mocks.storage.set(CONTENT_CACHE_STORAGE_KEY, { bundle: trainingContentBundle, checksum })
    expect(initializeTrainingContentFromCache()?.bundle.releaseVersion).toBe(1)
  })

  it('处理 304 时不覆盖缓存', async () => {
    mocks.storage.set(CONTENT_CACHE_STORAGE_KEY, { bundle: trainingContentBundle, checksum })
    mocks.request.mockResolvedValue({ statusCode: 304, data: '' })
    await expect(refreshTrainingContent()).resolves.toBe(false)
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('整包校验并应用 30 组远程内容，同时不改变 10 组内置兜底', async () => {
    expect(Object.keys(trainingContentBundle.sessions)).toHaveLength(10)
    mocks.request.mockResolvedValue({ statusCode: 200, data: { data: { bundle: remoteTrainingContentBundle, checksum } } })
    await expect(refreshTrainingContent()).resolves.toBe(true)
    const cached = parseContentCache(mocks.storage.get(CONTENT_CACHE_STORAGE_KEY))
    expect(Object.keys(cached?.bundle.sessions ?? {})).toHaveLength(30)
  })

  it('拒绝无效响应和低版本响应', async () => {
    mocks.request.mockResolvedValueOnce({ statusCode: 200, data: { data: { bundle: {}, checksum } } })
    await expect(refreshTrainingContent()).resolves.toBe(false)

    const release2 = structuredClone(trainingContentBundle)
    release2.releaseVersion = 2
    setTrainingContentBundle(release2)
    mocks.request.mockResolvedValueOnce({
      statusCode: 200,
      data: { data: { bundle: trainingContentBundle, checksum } },
    })
    await expect(refreshTrainingContent()).resolves.toBe(false)
    expect(mocks.storage.has(CONTENT_CACHE_STORAGE_KEY)).toBe(false)
  })
})
