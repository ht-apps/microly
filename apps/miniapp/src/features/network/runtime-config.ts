import { RuntimeConfigResponseSchema, type RuntimeConfig } from '@microly/api-contract'
import Taro from '@tarojs/taro'

import { getApiBaseUrl, isNetworkEnabled } from './network-config'

export const RUNTIME_CONFIG_STORAGE_KEY = 'microly:runtime-config:v1'
export const APP_VERSION = process.env.TARO_APP_VERSION || '1.0.0'

const fallback: RuntimeConfig = {
  revision: 1,
  environment: 'development',
  apiVersion: '1.0.0',
  minimumSupportedVersion: '1.0.0',
  maintenance: { active: false, message: null },
  features: { wechatLogin: true, accountSync: true, aiEvaluation: true, feedback: true },
  serverTime: new Date(0).toISOString(),
}

export function appVersionHeader() { return { 'X-Microly-App-Version': APP_VERSION } }

export function readRuntimeConfig() {
  try {
    const parsed = RuntimeConfigResponseSchema.shape.data.safeParse(Taro.getStorageSync<unknown>(RUNTIME_CONFIG_STORAGE_KEY))
    return parsed.success ? parsed.data : fallback
  } catch { return fallback }
}

function compareVersions(left: string, right: string) {
  const a = left.split(/[+-]/u, 1)[0]!.split('.').map(Number)
  const b = right.split(/[+-]/u, 1)[0]!.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta) return delta
  }
  return 0
}

export function requiresAppUpdate(config = readRuntimeConfig()) {
  return compareVersions(APP_VERSION, config.minimumSupportedVersion) < 0
}

export function canUseNetworkFeature(feature: keyof RuntimeConfig['features']) {
  const config = readRuntimeConfig()
  return !config.maintenance.active && !requiresAppUpdate(config) && config.features[feature]
}

let updateManager: ReturnType<typeof Taro.getUpdateManager> | null = null
let updateReady = false
let updateNoticeShown = false

export function installUpdateManager() {
  if (process.env.TARO_ENV !== 'weapp' || typeof Taro.getUpdateManager !== 'function' || updateManager) return
  updateManager = Taro.getUpdateManager()
  updateManager.onUpdateReady(() => {
    updateReady = true
    void Taro.showModal({ title: '新版本已准备好', content: '重启小程序即可使用最新版本。', confirmText: '立即重启' })
      .then((result) => { if (result.confirm) updateManager?.applyUpdate() })
  })
  updateManager.onUpdateFailed(() => { updateReady = false })
}

function notifyRuntimeState(config: RuntimeConfig) {
  if (requiresAppUpdate(config) && !updateNoticeShown) {
    updateNoticeShown = true
    void Taro.showModal({
      title: '需要更新版本',
      content: updateReady ? '新版本已经准备好，重启后即可继续联网同步。' : '请关闭并重新打开小程序获取最新版本。本地训练仍可继续使用。',
      confirmText: updateReady ? '立即重启' : '知道了', showCancel: false,
    }).then(() => { if (updateReady) updateManager?.applyUpdate() })
  } else if (config.maintenance.active) {
    void Taro.showToast({ title: config.maintenance.message || '服务维护中，本地训练仍可使用', icon: 'none', duration: 3000 })
  }
}

export async function refreshRuntimeConfig() {
  if (!isNetworkEnabled()) return readRuntimeConfig()
  try {
    const response = await Taro.request({ url: `${getApiBaseUrl()}/v1/runtime-config`, method: 'GET', header: appVersionHeader(), timeout: 5000 })
    const parsed = RuntimeConfigResponseSchema.safeParse(response.data)
    if (response.statusCode !== 200 || !parsed.success) return readRuntimeConfig()
    Taro.setStorageSync(RUNTIME_CONFIG_STORAGE_KEY, parsed.data.data)
    notifyRuntimeState(parsed.data.data)
    return parsed.data.data
  } catch { return readRuntimeConfig() }
}
