import { Text, View } from '@tarojs/components'
import '../legal.scss'

export default function PrivacyPage() {
  return <View className='legal-page'>
    <Text className='legal-badge'>测试版 · 正式上线前需审核</Text>
    <Text className='legal-title'>微习隐私政策</Text>
    <Text className='legal-copy'>为提供课程与学习同步，微习会处理随机安装标识的不可逆摘要、微信账号的不可逆摘要、训练完成记录、学习偏好、收藏、复习计划、学习活动和安全的训练位置。</Text>
    <Text className='legal-heading'>主动表达与 AI 点评</Text>
    <Text className='legal-copy'>主动表达原文默认只保存在设备。仅当微信登录用户明确点击“获取 AI 点评”时，原文会在本次请求中发送给 DeepSeek；微习服务端不保存原文，也不把原文写入日志或离线重试队列。云端仅保存不可逆输入摘要和经过严格校验的结构化点评。</Text>
    <Text className='legal-copy'>本地规则点评和界面临时展开状态不会上传。微习不申请头像、昵称或手机号。AI 点评仅供学习参考，不构成专业、法律或雇佣建议。</Text>
    <Text className='legal-heading'>运行诊断</Text>
    <Text className='legal-copy'>封测期间，应用可能上报错误分类、页面、应用与内容版本、网络类型、安全错误码和不可逆错误指纹，用于定位稳定性问题。错误报告不包含主动表达、请求正文、登录凭证、微信身份或原始堆栈；设备上的待发送报告最多保留 7 天，服务端报告最多保留 30 天。</Text>
    <Text className='legal-heading'>保留与删除</Text>
    <Text className='legal-copy'>云端学习数据及结构化 AI 点评在账号存续期间保留。你可在“账号与设置”中立即注销；操作成功后，账号、身份关联、学习数据和 AI 点评不可恢复地删除。退出登录只清理本机账号数据，不删除云端账号。</Text>
  </View>
}
