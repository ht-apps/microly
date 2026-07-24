import { describe, expect, it, vi } from 'vitest'

vi.mock('@tarojs/taro', () => ({ default: {} }))

import { stableErrorFingerprint } from './client-errors'

describe('client error privacy', () => {
  it('creates a stable opaque 64-character fingerprint', () => {
    const first = stableErrorFingerprint('runtime|error|/pages/index/index|1.0.0|typeerror')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(stableErrorFingerprint('runtime|error|/pages/index/index|1.0.0|typeerror')).toBe(first)
    expect(stableErrorFingerprint('runtime|error|/pages/course/index|1.0.0|typeerror')).not.toBe(first)
  })
})
