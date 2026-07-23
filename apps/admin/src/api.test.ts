import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminDraftValidationResponseSchema, AdminSessionResponseSchema } from '@microly/api-contract'

import { adminRequest, clearAdminToken, readAdminToken, saveAdminToken } from './api'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

describe('admin session client', () => {
  it('令牌只保存在会话存储', () => {
    saveAdminToken('secret')
    expect(readAdminToken()).toBe('secret')
    clearAdminToken()
    expect(readAdminToken()).toBe('')
  })

  it('保留服务端 401 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'admin_unauthorized', message: '管理令牌无效。' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
    await expect(adminRequest('/v1/admin/session', 'wrong', { schema: AdminSessionResponseSchema })).rejects.toEqual(expect.objectContaining({ status: 401, code: 'admin_unauthorized' }))
  })

  it('无请求体时不发送 JSON content-type', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer secret')
      expect(headers.has('Content-Type')).toBe(false)
      return new Response(JSON.stringify({ data: { valid: true, issues: [], normalizedBundle: {} } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(adminRequest('/v1/admin/content/drafts/test/validate', 'secret', { method: 'POST', schema: AdminDraftValidationResponseSchema }))
      .resolves.toEqual({ valid: true, issues: [], normalizedBundle: {} })
  })

  it('有请求体时发送 JSON content-type', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
      return new Response(JSON.stringify({ data: { authenticated: true } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(adminRequest('/v1/admin/content/drafts/test', 'secret', {
      method: 'PUT',
      body: JSON.stringify({ revision: 1, bundle: {} }),
      schema: AdminSessionResponseSchema,
    })).resolves.toEqual({ authenticated: true })
  })

  it('拒绝不符合共享契约的成功响应', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { authenticated: false } }), { status: 200 })))
    await expect(adminRequest('/v1/admin/session', 'secret', { schema: AdminSessionResponseSchema }))
      .rejects.toEqual(expect.objectContaining({ status: 502, code: 'invalid_response' }))
  })
})
