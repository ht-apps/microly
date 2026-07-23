import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { permanentlyDeleteAccount, readAccountStatus, signOut, upgradeToWechat } from '../../features/account/account-service'
import { flushFullSync } from '../../features/sync/state-sync'

import './index.scss'

export default function SettingsPage() {
  const [status, setStatus] = useState(readAccountStatus)
  const [busy, setBusy] = useState(false)
  useDidShow(() => setStatus(readAccountStatus()))

  const login = async () => {
    setBusy(true)
    const ok = await upgradeToWechat()
    setBusy(false)
    setStatus(readAccountStatus())
    Taro.showToast({ title: ok ? '已登录并同步' : '登录失败，请稍后重试', icon: ok ? 'success' : 'none' })
  }
  const sync = async () => {
    setBusy(true); const ok = await flushFullSync(true); setBusy(false); setStatus(readAccountStatus())
    Taro.showToast({ title: ok ? '同步完成' : '暂时无法同步', icon: ok ? 'success' : 'none' })
  }
  const logout = async () => {
    const confirm = await Taro.showModal({ title: '退出登录', content: '本机学习数据将被清除，云端数据保留。', confirmText: '退出' })
    if (!confirm.confirm) return
    await signOut(); Taro.reLaunch({ url: '/pages/onboarding/index' })
  }
  const remove = async () => {
    const first = await Taro.showModal({ title: '注销账号', content: '会立即且不可恢复地删除全部云端学习数据。', confirmText: '继续', confirmColor: '#c34a4a' })
    if (!first.confirm) return
    const second = await Taro.showModal({ title: '再次确认', content: '确定永久注销吗？', confirmText: '永久删除', confirmColor: '#c34a4a' })
    if (!second.confirm) return
    setBusy(true); const ok = await permanentlyDeleteAccount(); setBusy(false)
    if (ok) Taro.reLaunch({ url: '/pages/onboarding/index' })
    else Taro.showToast({ title: '注销失败，账号与数据未变更', icon: 'none' })
  }

  return <View className='settings-page'>
    <View className='settings-card'>
      <Text className='settings-title'>{status.authType === 'wechat' ? '已登录微信' : '游客模式'}</Text>
      <Text className='settings-body'>{status.syncState === 'local' ? '当前仅保存在本机' : status.syncState === 'pending' ? '有学习数据等待同步' : `已同步 · ${new Date(status.lastSyncAt as string).toLocaleString()}`}</Text>
      {status.authType !== 'wechat' && status.networkEnabled && <Button className='microly-button settings-primary' loading={busy} onClick={login}>微信登录并同步</Button>}
      {status.networkEnabled && <Button className='microly-button settings-secondary' loading={busy} onClick={sync}>立即同步</Button>}
    </View>
    <View className='settings-links'>
      <Button className='microly-button settings-link' onClick={() => Taro.navigateTo({ url: '/pages/privacy/index' })}>
        <Text>隐私政策</Text><Text className='settings-link__arrow'>›</Text>
      </Button>
      <Button className='microly-button settings-link' onClick={() => Taro.navigateTo({ url: '/pages/agreement/index' })}>
        <Text>用户协议</Text><Text className='settings-link__arrow'>›</Text>
      </Button>
      <Button className='microly-button settings-link' onClick={() => Taro.navigateTo({ url: '/pages/feedback/index' })}>
        <Text>意见反馈</Text><Text className='settings-link__arrow'>›</Text>
      </Button>
    </View>
    <View className='settings-account-actions'>
      {status.authType === 'wechat' && <Button className='microly-button settings-plain' onClick={logout}>退出登录</Button>}
      {status.networkEnabled && <Button className='microly-button settings-danger' loading={busy} onClick={remove}>注销账号</Button>}
    </View>
  </View>
}
