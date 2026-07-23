const TOKEN_KEY = 'microly:admin-token'
const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}

export function readAdminToken() { return sessionStorage.getItem(TOKEN_KEY) ?? '' }
export function saveAdminToken(token: string) { sessionStorage.setItem(TOKEN_KEY, token) }
export function clearAdminToken() { sessionStorage.removeItem(TOKEN_KEY) }

export async function adminRequest<T = unknown>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body !== undefined && init.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const value = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new ApiError(response.status, value?.error?.code ?? 'request_failed', value?.error?.message ?? '请求失败。')
  return value.data as T
}
