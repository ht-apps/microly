import {
  AccountSessionSchema,
  GuestAuthResponseSchema,
  WechatAuthResponseSchema,
  type AccountSession,
} from '@microly/api-contract'
import Taro from '@tarojs/taro'

import { createSecureUuid } from './identifier'
import { getApiBaseUrl, isNetworkEnabled } from './network-config'

export const INSTALLATION_ID_STORAGE_KEY = 'microly:network:installation:v1'
export const GUEST_AUTH_STORAGE_KEY = 'microly:network:guest-auth:v1'

export async function readInstallationId() {
  const stored = Taro.getStorageSync<unknown>(INSTALLATION_ID_STORAGE_KEY)
  if (typeof stored === 'string' && stored.length > 0) return stored
  const installationId = await createSecureUuid()
  Taro.setStorageSync(INSTALLATION_ID_STORAGE_KEY, installationId)
  return installationId
}

export function readStoredAuth(): AccountSession | null {
  try {
    const parsed = AccountSessionSchema.safeParse(Taro.getStorageSync<unknown>(GUEST_AUTH_STORAGE_KEY))
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) return null
    return parsed.data
  } catch { return null }
}

export function clearGuestAuth(rotateInstallation = false) {
  try {
    Taro.removeStorageSync(GUEST_AUTH_STORAGE_KEY)
    if (rotateInstallation) Taro.removeStorageSync(INSTALLATION_ID_STORAGE_KEY)
  } catch { /* A later request can recreate local identity. */ }
}

export async function getGuestAuth(forceRefresh = false) {
  if (!isNetworkEnabled()) return null
  if (!forceRefresh) {
    const stored = readStoredAuth()
    if (stored) return stored
  }
  const response = await Taro.request({
    url: `${getApiBaseUrl()}/v1/auth/guest`, method: 'POST',
    data: { installationId: await readInstallationId() }, timeout: 8000,
  })
  if (response.statusCode < 200 || response.statusCode >= 300) return null
  const parsed = GuestAuthResponseSchema.safeParse(response.data)
  if (!parsed.success) return null
  const session: AccountSession = {
    accountId: parsed.data.data.accountId,
    authType: parsed.data.data.authType,
    token: parsed.data.data.token,
    expiresAt: parsed.data.data.expiresAt,
  }
  Taro.setStorageSync(GUEST_AUTH_STORAGE_KEY, session)
  return session
}

export async function loginWithWechat() {
  if (!isNetworkEnabled()) return null
  const login = await Taro.login()
  if (!login.code) return null
  const response = await authorizedRequest<unknown>({ path: '/v1/auth/wechat', method: 'POST', data: { code: login.code } })
  const parsed = WechatAuthResponseSchema.safeParse(response?.data)
  if (!response || response.statusCode !== 200 || !parsed.success) return null
  const { merged: _merged, ...session } = parsed.data.data
  Taro.setStorageSync(GUEST_AUTH_STORAGE_KEY, session)
  return parsed.data.data
}

export async function authorizedRequest<T>(options: {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: unknown
}) {
  const execute = async (refresh: boolean) => {
    const auth = await getGuestAuth(refresh)
    if (!auth) return null
    return Taro.request<T>({
      url: `${getApiBaseUrl()}${options.path}`, method: options.method,
      data: options.data, header: { Authorization: `Bearer ${auth.token}` }, timeout: 8000,
    })
  }
  let response = await execute(false)
  if (response?.statusCode === 401) {
    clearGuestAuth()
    response = await execute(true)
  }
  return response
}

export async function logoutAccount() {
  try { await authorizedRequest({ path: '/v1/auth/logout', method: 'POST' }) } catch { /* best effort */ }
  clearGuestAuth(true)
}

export async function deleteAccount() {
  const response = await authorizedRequest<unknown>({ path: '/v1/account', method: 'DELETE', data: { confirmation: 'DELETE' } })
  if (response?.statusCode !== 200) return false
  clearGuestAuth(true)
  return true
}
