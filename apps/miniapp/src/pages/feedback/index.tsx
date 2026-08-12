import { useState } from 'react'
import { Button, Picker, Text, Textarea, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { FeedbackResponseSchema } from '@microly/api-contract'

import { authorizedRequest } from '../../features/network/guest-auth'
import { canUseNetworkFeature } from '../../features/network/runtime-config'
import { flushAnalyticsOutbox, trackEvent } from '../../features/analytics/analytics-client'
import './index.scss'

const categories = [
  { value: 'product_suggestion', label: '产品建议' },
  { value: 'content_error', label: '内容错误' },
  { value: 'inappropriate_content', label: '不当内容' },
] as const

export default function FeedbackPage() {
  const [index, setIndex] = useState(0)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!canUseNetworkFeature('feedback')) {
      Taro.showToast({ title: '反馈服务暂不可用，请稍后再试', icon: 'none' })
      return
    }
    const content = detail.trim()
    if (content.length < 10) return Taro.showToast({ title: '请至少输入 10 个字', icon: 'none' })
    setBusy(true)
    try {
      const response = await authorizedRequest<unknown>({ path: '/v1/feedback', method: 'POST', data: { category: categories[index].value, detail: content } })
      const parsed = FeedbackResponseSchema.safeParse(response?.data)
      if (!response || response.statusCode !== 201 || !parsed.success) throw new Error('failed')
      trackEvent('feedback_submit', { category: categories[index].value })
      void flushAnalyticsOutbox()
      Taro.showToast({ title: '已提交', icon: 'success' }); setDetail('')
    } catch { Taro.showToast({ title: '提交失败，请稍后重试', icon: 'none' }) }
    setBusy(false)
  }
  return <View className='feedback-page'>
    <Text className='feedback-label'>反馈类型</Text>
    <Picker mode='selector' range={categories.map((item) => item.label)} value={index} onChange={(event) => setIndex(Number(event.detail.value))}>
      <View className='feedback-picker'>{categories[index].label} ›</View>
    </Picker>
    <Text className='feedback-label'>详细说明</Text>
    <Textarea className='feedback-textarea' maxlength={500} value={detail} placeholder='请描述你遇到的问题或建议（请勿填写隐私信息）' onInput={(event) => setDetail(event.detail.value)} />
    <Text className='feedback-count'>{detail.length}/500</Text>
    <Button className='microly-button feedback-submit' loading={busy} onClick={submit}>提交反馈</Button>
  </View>
}
