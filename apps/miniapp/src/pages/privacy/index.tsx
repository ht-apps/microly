import { Text, View } from '@tarojs/components'
import '../legal.scss'

export default function PrivacyPage() {
  return <View className='legal-page'>
    <Text className='legal-badge'>测试版 · 正式上线前需审核</Text>
    <Text className='legal-title'>微习隐私政策</Text>
    <Text className='legal-copy'>为提供课程与学习同步，微习会处理随机安装标识的不可逆摘要、微信账号的不可逆摘要、训练完成记录、学习偏好、收藏、复习计划、学习活动和安全的训练位置。</Text>
    <Text className='legal-heading'>始终只保存在设备</Text>
    <Text className='legal-copy'>主动表达原文、本地规则点评和界面临时展开状态不会上传。微习不申请头像、昵称或手机号。</Text>
    <Text className='legal-heading'>保留与删除</Text>
    <Text className='legal-copy'>云端学习数据在账号存续期间保留。你可在“账号与设置”中立即注销；操作成功后，账号、身份关联和学习数据不可恢复地删除。退出登录只清理本机账号数据，不删除云端账号。</Text>
  </View>
}
