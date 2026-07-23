import { Text, View } from '@tarojs/components'
import '../legal.scss'

export default function AgreementPage() {
  return <View className='legal-page'>
    <Text className='legal-badge'>测试版 · 正式上线前需审核</Text>
    <Text className='legal-title'>微习用户协议</Text>
    <Text className='legal-copy'>微习提供短时学习、本地练习反馈与可选的跨设备同步。游客可在不登录的情况下使用核心训练；微信登录只用于关联学习记录。</Text>
    <Text className='legal-heading'>使用规则</Text>
    <Text className='legal-copy'>请不要利用反馈功能提交违法、侵权或他人隐私信息。课程和本地点评用于学习参考，不构成专业、法律或雇佣建议。</Text>
    <Text className='legal-heading'>服务变更</Text>
    <Text className='legal-copy'>测试阶段功能可能调整或暂时不可用。断网时仍可使用内置训练，但跨设备同步、反馈和注销需要联网。</Text>
  </View>
}
