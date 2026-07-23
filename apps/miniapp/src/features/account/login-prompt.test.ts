import { describe, expect, it } from 'vitest'

import { shouldPromptWechatLogin } from './login-prompt'

describe('训练完成登录提示', () => {
  it('只对尚未提示过的联网游客显示', () => {
    expect(shouldPromptWechatLogin({ prompted: false, networkEnabled: true, authType: 'guest' })).toBe(true)
    expect(shouldPromptWechatLogin({ prompted: false, networkEnabled: true, authType: 'wechat' })).toBe(false)
    expect(shouldPromptWechatLogin({ prompted: true, networkEnabled: true, authType: 'guest' })).toBe(false)
    expect(shouldPromptWechatLogin({ prompted: false, networkEnabled: false, authType: 'guest' })).toBe(false)
  })
})
