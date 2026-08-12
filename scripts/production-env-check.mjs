import { loadEnvFile } from 'node:process'
import { spawnSync } from 'node:child_process'

loadEnvFile('.env.production')
const required = ['APP_ENV', 'APP_VERSION', 'MICROLY_IMAGE_TAG', 'MICROLY_OPERATIONS_IMAGE_TAG', 'API_DOMAIN', 'ADMIN_DOMAIN', 'API_PUBLIC_ORIGIN', 'ADMIN_PUBLIC_ORIGIN', 'TARO_APP_API_BASE_URL', 'TARO_APP_VERSION', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'IDENTITY_HASH_SECRET', 'ADMIN_API_TOKEN']
const missing = required.filter((key) => !process.env[key])
if (missing.length) throw new Error(`缺少生产配置：${missing.join(', ')}`)
if (process.env.APP_ENV !== 'production') throw new Error('APP_ENV 必须为 production。')
for (const key of ['API_PUBLIC_ORIGIN', 'ADMIN_PUBLIC_ORIGIN']) {
  const url = new URL(process.env[key])
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`${key} 必须为非本机 HTTPS 地址。`)
}
if (process.env.API_DOMAIN !== new URL(process.env.API_PUBLIC_ORIGIN).hostname) throw new Error('API_DOMAIN 与 API_PUBLIC_ORIGIN 不一致。')
if (process.env.ADMIN_DOMAIN !== new URL(process.env.ADMIN_PUBLIC_ORIGIN).hostname) throw new Error('ADMIN_DOMAIN 与 ADMIN_PUBLIC_ORIGIN 不一致。')
if (decodeURIComponent(new URL(process.env.DATABASE_URL).password) !== process.env.POSTGRES_PASSWORD) throw new Error('DATABASE_URL 与 POSTGRES_PASSWORD 不一致。')
if (process.env.MICROLY_IMAGE_TAG !== process.env.APP_VERSION) throw new Error('镜像标签必须与应用版本一致。')
if (process.env.MICROLY_OPERATIONS_IMAGE_TAG !== process.env.APP_VERSION) throw new Error('运维镜像标签必须与应用版本一致。')
if (process.env.TARO_APP_API_BASE_URL !== process.env.API_PUBLIC_ORIGIN) throw new Error('小程序 API 地址必须与 API_PUBLIC_ORIGIN 一致。')
if (process.env.TARO_APP_VERSION !== process.env.APP_VERSION) throw new Error('小程序版本必须与 APP_VERSION 一致。')
process.stdout.write(`生产环境文件有效：${process.env.APP_VERSION}\n`)
const validation = spawnSync('pnpm', ['--filter', '@microly/api', 'exec', 'node', '--import', 'tsx', 'src/scripts/check-config.ts'], { stdio: 'inherit', env: process.env })
if (validation.status !== 0) process.exit(validation.status ?? 1)
