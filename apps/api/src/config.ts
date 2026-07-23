import { loadEnvFile } from 'node:process'

import { z } from 'zod'

try { loadEnvFile('.env.local') } catch { /* Environment variables may be supplied by the process. */ }

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WECHAT_APP_ID: z.string().min(1).optional(),
  WECHAT_APP_SECRET: z.string().min(1).optional(),
  IDENTITY_HASH_SECRET: z.string().min(32).optional(),
  ADMIN_API_TOKEN: z.string().min(32).optional(),
  ADMIN_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  AI_INPUT_HASH_SECRET: z.string().min(32).optional(),
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
})

export interface ApiConfig {
  databaseUrl: string
  port: number
  wechat?: { appId: string; appSecret: string; identityHashSecret: string }
  admin?: { token: string; origins: string[] }
  ai?: { apiKey: string; inputHashSecret: string; baseUrl: string }
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.parse(environment)
  return {
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.API_PORT,
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
  }
}
