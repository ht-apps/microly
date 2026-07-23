export function getApiBaseUrl() {
  return (process.env.TARO_APP_API_BASE_URL ?? '').trim().replace(/\/$/, '')
}

export function isNetworkEnabled() {
  return getApiBaseUrl().length > 0
}
