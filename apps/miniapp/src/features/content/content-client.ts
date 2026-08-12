import { ContentResponseSchema } from '@microly/api-contract'
import type { TrainingContentBundle } from '@microly/content-schema'
import {
  currentTrainingContentBundle,
  loadTrainingContentBundle,
  setTrainingContentBundle,
} from '@microly/training-content'
import Taro from '@tarojs/taro'

import { getApiBaseUrl, isNetworkEnabled } from '../network/network-config'
import { captureClientError } from '../diagnostics/client-errors'
import { appVersionHeader } from '../network/runtime-config'

export const CONTENT_CACHE_STORAGE_KEY = 'microly:content-cache:v1'
export const CONTENT_UPDATED_EVENT = 'microly:content-updated'

interface ContentCache {
  bundle: TrainingContentBundle
  checksum: string
}

function isChecksum(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

export function parseContentCache(value: unknown): ContentCache | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const loaded = loadTrainingContentBundle(candidate.bundle)
  if (!loaded || !isChecksum(candidate.checksum)) return null
  return { bundle: loaded.bundle, checksum: candidate.checksum }
}

export function initializeTrainingContentFromCache() {
  try {
    const cached = parseContentCache(Taro.getStorageSync(CONTENT_CACHE_STORAGE_KEY))
    if (!cached || cached.bundle.releaseVersion < currentTrainingContentBundle.releaseVersion) {
      return null
    }
    setTrainingContentBundle(cached.bundle)
    return cached
  } catch {
    return null
  }
}

function readCachedContent() {
  try {
    return parseContentCache(Taro.getStorageSync(CONTENT_CACHE_STORAGE_KEY))
  } catch {
    return null
  }
}

export async function refreshTrainingContent() {
  if (!isNetworkEnabled()) return false
  const cached = readCachedContent()
  try {
    const response = await Taro.request({
      url: `${getApiBaseUrl()}/v1/content/current`,
      method: 'GET',
      header: { ...appVersionHeader(), ...(cached ? { 'If-None-Match': `"${cached.checksum}"` } : {}) },
      timeout: 8000,
    })
    if (response.statusCode === 304) return false
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode >= 500) captureClientError('content', null, { severity: 'warning', errorCode: `http_${response.statusCode}` })
      return false
    }
    const parsed = ContentResponseSchema.safeParse(response.data)
    if (!parsed.success) { captureClientError('content', null, { errorCode: 'invalid_content_response' }); return false }
    const { bundle, checksum } = parsed.data.data
    if (bundle.releaseVersion < currentTrainingContentBundle.releaseVersion) return false
    if (!setTrainingContentBundle(bundle)) return false
    Taro.setStorageSync(CONTENT_CACHE_STORAGE_KEY, { bundle, checksum })
    Taro.eventCenter.trigger(CONTENT_UPDATED_EVENT, bundle.releaseVersion)
    return true
  } catch (cause) {
    captureClientError('content', cause, { severity: 'warning', errorCode: 'content_request_failed' })
    return false
  }
}

export function subscribeToContentUpdates(listener: () => void) {
  Taro.eventCenter.on(CONTENT_UPDATED_EVENT, listener)
  return () => {
    Taro.eventCenter.off(CONTENT_UPDATED_EVENT, listener)
  }
}
