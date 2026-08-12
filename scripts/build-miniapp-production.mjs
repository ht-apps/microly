import { spawnSync } from 'node:child_process'

const apiBaseUrl = process.env.TARO_APP_API_BASE_URL
const appVersion = process.env.TARO_APP_VERSION
if (!apiBaseUrl || !appVersion) throw new Error('必须显式配置 TARO_APP_API_BASE_URL 和 TARO_APP_VERSION。')
const parsed = new URL(apiBaseUrl)
if (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  throw new Error('封测小程序必须使用非本机 HTTPS API 地址。')
}
if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(appVersion)) throw new Error('小程序版本号格式无效。')

const result = spawnSync('pnpm', ['build:miniapp'], { env: process.env, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
