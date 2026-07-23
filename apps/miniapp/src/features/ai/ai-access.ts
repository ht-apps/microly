export type AiAccessState = 'ready' | 'login_required' | 'unavailable'

export function resolveAiAccessState(input: {
  networkEnabled: boolean
  authType: 'guest' | 'wechat'
}): AiAccessState {
  if (!input.networkEnabled) return 'unavailable'
  return input.authType === 'wechat' ? 'ready' : 'login_required'
}
