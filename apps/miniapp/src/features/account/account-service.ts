import Taro from '@tarojs/taro'

import { deleteAccount, loginWithWechat, logoutAccount, readStoredAuth } from '../network/guest-auth'
import { isNetworkEnabled } from '../network/network-config'
import { flushFullSync, readLastSyncAt } from '../sync/state-sync'
import { FULL_SYNC_PENDING_KEY } from '../sync/sync-pending'
import { flushAnalyticsOutbox, trackEvent } from '../analytics/analytics-client'

export function readAccountStatus() {
  const auth = readStoredAuth()
  const networkEnabled = isNetworkEnabled()
  const lastSyncAt = readLastSyncAt()
  const pending = Boolean(Taro.getStorageSync(FULL_SYNC_PENDING_KEY))
  return {
    networkEnabled,
    authType: auth?.authType ?? 'guest' as const,
    accountId: auth?.accountId ?? null,
    lastSyncAt,
    syncState: !networkEnabled ? 'local' as const : pending ? 'pending' as const : lastSyncAt ? 'synced' as const : 'pending' as const,
  }
}

export async function upgradeToWechat() {
  const session = await loginWithWechat()
  if (!session) return false
  trackEvent('wechat_login_success', { merged: session.merged })
  await flushFullSync()
  await flushAnalyticsOutbox()
  return true
}

export function clearAccountLocalData() {
  try {
    const keys = Taro.getStorageInfoSync().keys
    keys.forEach((key) => {
      if (key.startsWith('microly:') && key !== 'microly:content-cache:v1') {
        Taro.removeStorageSync(key)
      }
    })
  } catch { /* Storage can be recreated on the next launch. */ }
}

export async function signOut() {
  await logoutAccount()
  clearAccountLocalData()
}

export async function permanentlyDeleteAccount() {
  const deleted = await deleteAccount()
  if (deleted) clearAccountLocalData()
  return deleted
}
