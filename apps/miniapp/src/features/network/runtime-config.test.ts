import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ storage: new Map<string, unknown>(), request: vi.fn(), toast: vi.fn() }))
vi.mock('@tarojs/taro', () => ({ default: {
  getStorageSync: (key: string) => mocks.storage.get(key),
  setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value),
  request: mocks.request,
  showToast: mocks.toast,
} }))

import { APP_VERSION, RUNTIME_CONFIG_STORAGE_KEY, appVersionHeader, canUseNetworkFeature, readRuntimeConfig, refreshRuntimeConfig } from './runtime-config'

describe('miniapp runtime config', () => {
  beforeEach(() => { mocks.storage.clear(); mocks.request.mockReset(); mocks.toast.mockReset(); process.env.TARO_APP_API_BASE_URL = 'https://api.example.com' })

  it('adds the immutable app version header', () => {
    expect(appVersionHeader()).toEqual({ 'X-Microly-App-Version': APP_VERSION })
  })

  it('caches validated runtime config and disables paused sync', async () => {
    const value = { revision: 2, environment: 'production', apiVersion: '1.0.0', minimumSupportedVersion: '1.0.0', maintenance: { active: false, message: null }, features: { wechatLogin: true, accountSync: false, aiEvaluation: true, feedback: true }, serverTime: '2026-07-24T10:00:00.000Z' }
    mocks.request.mockResolvedValue({ statusCode: 200, data: { data: value } })
    await expect(refreshRuntimeConfig()).resolves.toEqual(value)
    expect(mocks.storage.get(RUNTIME_CONFIG_STORAGE_KEY)).toEqual(value)
    expect(readRuntimeConfig().revision).toBe(2)
    expect(canUseNetworkFeature('accountSync')).toBe(false)
    expect(mocks.request.mock.calls[0][0].header).toEqual({ 'X-Microly-App-Version': APP_VERSION })
  })

  it('keeps the last valid config when the response is invalid', async () => {
    mocks.request.mockResolvedValue({ statusCode: 200, data: { data: { token: 'secret' } } })
    expect((await refreshRuntimeConfig()).revision).toBe(1)
  })
})
