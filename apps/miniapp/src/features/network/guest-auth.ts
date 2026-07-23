import { GuestAuthResponseSchema } from '@microly/api-contract'
import Taro from '@tarojs/taro'

import { createSecureUuid } from './identifier'
import { getApiBaseUrl, isNetworkEnabled } from './network-config'

export const INSTALLATION_ID_STORAGE_KEY = 'microly:network:installation:v1'
export const GUEST_AUTH_STORAGE_KEY = 'microly:network:guest-auth:v1'

interface StoredGuestAuth {
  guestId: string
  token: string
  expiresAt: string
}

async function readInstallationId() {
  const stored = Taro.getStorageSync<unknown>(INSTALLATION_ID_STORAGE_KEY)
  if (typeof stored === 'string' && stored.length > 0) return stored
  const installationId = await createSecureUuid()
  Taro.setStorageSync(INSTALLATION_ID_STORAGE_KEY, installationId)
  return installationId
}

function readStoredAuth(): StoredGuestAuth | null {
  const stored = Taro.getStorageSync<unknown>(GUEST_AUTH_STORAGE_KEY)
  const parsed = GuestAuthResponseSchema.shape.data.safeParse(stored)
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) return null
  return parsed.data
}

export function clearGuestAuth() {
  try {
    Taro.removeStorageSync(GUEST_AUTH_STORAGE_KEY)
  } catch {
    // A later request can retry without a cached token.
  }
}

export async function getGuestAuth(forceRefresh = false) {
  if (!isNetworkEnabled()) return null
  if (!forceRefresh) {
    try {
      const stored = readStoredAuth()
      if (stored) return stored
    } catch {
      // Continue with a new guest session.
    }
  }

  const response = await Taro.request({
    url: `${getApiBaseUrl()}/v1/auth/guest`,
    method: 'POST',
    data: { installationId: await readInstallationId() },
    timeout: 8000,
  })
  if (response.statusCode < 200 || response.statusCode >= 300) return null
  const parsed = GuestAuthResponseSchema.safeParse(response.data)
  if (!parsed.success) return null
  Taro.setStorageSync(GUEST_AUTH_STORAGE_KEY, parsed.data.data)
  return parsed.data.data
}

export async function authorizedRequest<T>(options: {
  path: string
  method: 'GET' | 'POST'
  data?: unknown
}) {
  const execute = async (refresh: boolean) => {
    const auth = await getGuestAuth(refresh)
    if (!auth) return null
    return Taro.request<T>({
      url: `${getApiBaseUrl()}${options.path}`,
      method: options.method,
      data: options.data,
      header: { Authorization: `Bearer ${auth.token}` },
      timeout: 8000,
    })
  }

  let response = await execute(false)
  if (response?.statusCode === 401) {
    clearGuestAuth()
    response = await execute(true)
  }
  return response
}
