import { describe, expect, it } from 'vitest'

import { readConfig } from './config.js'

describe('API production config', () => {
  it('keeps local mode minimal', () => {
    expect(readConfig({ DATABASE_URL: 'postgresql://microly:microly@localhost:5432/microly' }).runtime.environment).toBe('development')
  })

  it('rejects localhost and example production secrets', () => {
    expect(() => readConfig({
      DATABASE_URL: 'postgresql://microly:microly@localhost:5432/microly', APP_ENV: 'production', APP_VERSION: '1.0.0',
      API_PUBLIC_ORIGIN: 'http://localhost:3000', ADMIN_PUBLIC_ORIGIN: 'http://localhost:5173',
      WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'replace_with_secret', IDENTITY_HASH_SECRET: 'replace_with_at_least_32_random_characters',
      ADMIN_API_TOKEN: 'replace_with_at_least_32_random_characters',
    })).toThrow()
  })

  it('accepts complete HTTPS production config', () => {
    const config = readConfig({
      DATABASE_URL: 'postgresql://microly:7mY!2xC9sQ4vN6pL@postgres:5432/microly', APP_ENV: 'production', APP_VERSION: '1.0.0',
      API_PUBLIC_ORIGIN: 'https://api.microly.cn', ADMIN_PUBLIC_ORIGIN: 'https://admin.microly.cn',
      WECHAT_APP_ID: 'wx-valid', WECHAT_APP_SECRET: 'a'.repeat(40), IDENTITY_HASH_SECRET: 'b'.repeat(40),
      ADMIN_API_TOKEN: 'c'.repeat(40), ADMIN_ORIGINS: 'https://admin.microly.cn',
    })
    expect(config.runtime.environment).toBe('production')
  })

  it('rejects malformed database URLs and short production passwords', () => {
    const base = {
      APP_ENV: 'production', APP_VERSION: '1.0.0', API_PUBLIC_ORIGIN: 'https://api.microly.test',
      ADMIN_PUBLIC_ORIGIN: 'https://admin.microly.test', WECHAT_APP_ID: 'wx-valid-production',
      WECHAT_APP_SECRET: 'a'.repeat(32), IDENTITY_HASH_SECRET: 'b'.repeat(40), ADMIN_API_TOKEN: 'c'.repeat(40),
    }
    expect(() => readConfig({ ...base, DATABASE_URL: 'not-a-database-url' })).toThrow()
    expect(() => readConfig({ ...base, DATABASE_URL: 'postgresql://microly:short@postgres:5432/microly' })).toThrow()
  })
})
