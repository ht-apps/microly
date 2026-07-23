import { describe, expect, it } from 'vitest'

import { resolveAiAccessState } from './ai-access'

describe('resolveAiAccessState', () => {
  it('allows AI for a WeChat account when networking is configured', () => {
    expect(resolveAiAccessState({ networkEnabled: true, authType: 'wechat' })).toBe('ready')
  })

  it('asks an online guest to sign in', () => {
    expect(resolveAiAccessState({ networkEnabled: true, authType: 'guest' })).toBe('login_required')
  })

  it('does not misreport missing network configuration as a login problem', () => {
    expect(resolveAiAccessState({ networkEnabled: false, authType: 'wechat' })).toBe('unavailable')
    expect(resolveAiAccessState({ networkEnabled: false, authType: 'guest' })).toBe('unavailable')
  })
})
