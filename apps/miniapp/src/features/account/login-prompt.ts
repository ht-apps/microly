export function shouldPromptWechatLogin(input: {
  prompted: boolean
  networkEnabled: boolean
  authType: 'guest' | 'wechat'
}) {
  return !input.prompted && input.networkEnabled && input.authType === 'guest'
}
