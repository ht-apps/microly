import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
}))

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => mocks.storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
    removeStorageSync: (key: string) => mocks.storage.delete(key),
    getRandomValues: async () => ({
      randomValues: Uint8Array.from({ length: 16 }, (_, index) => index + 1).buffer,
    }),
  },
}))

import { createLocalSyncRequest } from './state-sync'

describe('full state sync', () => {
  beforeEach(() => mocks.storage.clear())

  it('首次同步在存储返回空字符串时生成 UUID', async () => {
    const request = await createLocalSyncRequest()

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
