import Taro from '@tarojs/taro'

export const FULL_SYNC_PENDING_KEY = 'microly:sync:full-pending:v1'

export function markFullSyncPending() {
  try { Taro.setStorageSync(FULL_SYNC_PENDING_KEY, true) } catch { /* retry on next bootstrap */ }
}

export function clearFullSyncPending() {
  try { Taro.removeStorageSync(FULL_SYNC_PENDING_KEY) } catch { /* harmless */ }
}
