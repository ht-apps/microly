import { loadEnvFile } from 'node:process'

import { z } from 'zod'

try { loadEnvFile('.env.local') } catch { /* Environment variables may be supplied by the process. */ }

const optionalString = (minimum = 1) => z.preprocess((value) => value === '' ? undefined : value, z.string().min(minimum).optional())
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.url().optional())

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/).default('1.0.0'),
  API_PUBLIC_ORIGIN: optionalUrl,
  ADMIN_PUBLIC_ORIGIN: optionalUrl,
  WECHAT_APP_ID: optionalString(),
  WECHAT_APP_SECRET: optionalString(),
  IDENTITY_HASH_SECRET: optionalString(32),
  ADMIN_API_TOKEN: optionalString(32),
  ADMIN_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  DEEPSEEK_API_KEY: optionalString(),
  AI_INPUT_HASH_SECRET: optionalString(32),
  ALERT_WEBHOOK_URL: optionalUrl,
  ALERT_COOLDOWN_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
}).superRefine((value, context) => {
  const configured = [
    value.WECHAT_APP_ID,
    value.WECHAT_APP_SECRET,
    value.IDENTITY_HASH_SECRET,
  ].filter(Boolean).length
  if (configured !== 0 && configured !== 3) {
    context.addIssue({
      code: 'custom',
      message: '微信登录配置必须同时提供 WECHAT_APP_ID、WECHAT_APP_SECRET 和 IDENTITY_HASH_SECRET。',
      path: ['WECHAT_APP_ID'],
    })
  }
  const aiConfigured = [value.DEEPSEEK_API_KEY, value.AI_INPUT_HASH_SECRET].filter(Boolean).length
  if (aiConfigured !== 0 && aiConfigured !== 2) {
    context.addIssue({
      code: 'custom',
      message: 'AI 点评配置必须同时提供 DEEPSEEK_API_KEY 和 AI_INPUT_HASH_SECRET。',
      path: ['DEEPSEEK_API_KEY'],
    })
  }
  if (value.APP_ENV === 'production') {
    const required: Array<[keyof typeof value, unknown]> = [
      ['API_PUBLIC_ORIGIN', value.API_PUBLIC_ORIGIN], ['ADMIN_PUBLIC_ORIGIN', value.ADMIN_PUBLIC_ORIGIN],
      ['WECHAT_APP_ID', value.WECHAT_APP_ID], ['WECHAT_APP_SECRET', value.WECHAT_APP_SECRET],
      ['IDENTITY_HASH_SECRET', value.IDENTITY_HASH_SECRET], ['ADMIN_API_TOKEN', value.ADMIN_API_TOKEN],
    ]
    required.forEach(([path, configuredValue]) => {
      if (!configuredValue) context.addIssue({ code: 'custom', path: [path], message: '生产环境必须配置此项。' })
    })
    for (const [path, origin] of [['API_PUBLIC_ORIGIN', value.API_PUBLIC_ORIGIN], ['ADMIN_PUBLIC_ORIGIN', value.ADMIN_PUBLIC_ORIGIN]] as const) {
      if (!origin) continue
      try {
        const parsed = new URL(origin)
        const placeholderHost = parsed.hostname === 'example.com' || parsed.hostname.endsWith('.example.com')
          || parsed.hostname.endsWith('.test') || parsed.hostname.endsWith('.invalid')
        if (parsed.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(parsed.hostname) || parsed.hostname.endsWith('.local') || placeholderHost) {
          context.addIssue({ code: 'custom', path: [path], message: '生产环境必须使用非本机 HTTPS 地址。' })
        }
      } catch {
        context.addIssue({ code: 'custom', path: [path], message: '生产地址格式无效。' })
      }
    }
    if (value.ALERT_WEBHOOK_URL) {
      try {
        if (new URL(value.ALERT_WEBHOOK_URL).protocol !== 'https:') {
          context.addIssue({ code: 'custom', path: ['ALERT_WEBHOOK_URL'], message: '生产告警地址必须使用 HTTPS。' })
        }
      } catch {
        context.addIssue({ code: 'custom', path: ['ALERT_WEBHOOK_URL'], message: '生产告警地址格式无效。' })
      }
    }
    const weakValues = ['microly', 'password', 'replace_with', 'replace-with', 'change_me', 'change-me', 'your_', 'your-', 'example']
    let databasePassword = ''
    let databaseProtocol = ''
    try {
      const database = new URL(value.DATABASE_URL)
      databasePassword = decodeURIComponent(database.password)
      databaseProtocol = database.protocol
    } catch { /* Reported as a strong database URL validation failure below. */ }
    if (databaseProtocol !== 'postgresql:' || databasePassword.length < 16 || weakValues.some((part) => databasePassword.toLowerCase().includes(part))) {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: '生产数据库必须使用强密码。' })
    }
    for (const [path, secret, minimum] of [['WECHAT_APP_SECRET', value.WECHAT_APP_SECRET, 16], ['IDENTITY_HASH_SECRET', value.IDENTITY_HASH_SECRET, 32], ['ADMIN_API_TOKEN', value.ADMIN_API_TOKEN, 32]] as const) {
      if (secret && (secret.length < minimum || weakValues.some((part) => secret.toLowerCase().includes(part)))) {
        context.addIssue({ code: 'custom', path: [path], message: '生产密钥不能使用示例值或弱口令。' })
      }
    }
    if (value.WECHAT_APP_ID && weakValues.some((part) => value.WECHAT_APP_ID!.toLowerCase().includes(part))) {
      context.addIssue({ code: 'custom', path: ['WECHAT_APP_ID'], message: '生产微信 App ID 不能使用示例值。' })
    }
  }
})

export interface ApiConfig {
  databaseUrl: string
  port: number
  runtime: { environment: 'development' | 'test' | 'production'; appVersion: string; apiPublicOrigin?: string; adminPublicOrigin?: string }
  wechat?: { appId: string; appSecret: string; identityHashSecret: string }
  admin?: { token: string; origins: string[] }
  ai?: { apiKey: string; inputHashSecret: string; baseUrl: string }
  alerts?: { webhookUrl: string; cooldownMinutes: number }
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.parse(environment)
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.API_PORT,
    runtime: {
      environment: parsed.APP_ENV,
      appVersion: parsed.APP_VERSION,
      apiPublicOrigin: parsed.API_PUBLIC_ORIGIN,
      adminPublicOrigin: parsed.ADMIN_PUBLIC_ORIGIN,
    },
    wechat: parsed.WECHAT_APP_ID && parsed.WECHAT_APP_SECRET && parsed.IDENTITY_HASH_SECRET
      ? {
          appId: parsed.WECHAT_APP_ID,
          appSecret: parsed.WECHAT_APP_SECRET,
          identityHashSecret: parsed.IDENTITY_HASH_SECRET,
        }
      : undefined,
    admin: parsed.ADMIN_API_TOKEN
      ? {
          token: parsed.ADMIN_API_TOKEN,
          origins: parsed.ADMIN_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
        }
      : undefined,
    ai: parsed.DEEPSEEK_API_KEY && parsed.AI_INPUT_HASH_SECRET
      ? { apiKey: parsed.DEEPSEEK_API_KEY, inputHashSecret: parsed.AI_INPUT_HASH_SECRET, baseUrl: 'https://api.deepseek.com' }
      : undefined,
    alerts: parsed.ALERT_WEBHOOK_URL
      ? { webhookUrl: parsed.ALERT_WEBHOOK_URL, cooldownMinutes: parsed.ALERT_COOLDOWN_MINUTES }
      : undefined,
  }
}
