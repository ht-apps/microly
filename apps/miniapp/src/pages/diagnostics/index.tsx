import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'

import { currentTrainingContentBundle } from '../../data/training-content'
import { readAccountStatus } from '../../features/account/account-service'
import { flushClientErrors, readClientDiagnostics } from '../../features/diagnostics/client-errors'

import './index.scss'

export default function DiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState(readClientDiagnostics)
  const [busy, setBusy] = useState(false)
  const account = readAccountStatus()
  useDidShow(() => setDiagnostics(readClientDiagnostics()))
  const retry = async () => {
    setBusy(true)
    const count = await flushClientErrors()
    setBusy(false); setDiagnostics(readClientDiagnostics())
    void Taro.showToast({ title: count ? `已发送 ${count} 条报告` : '暂无可发送报告', icon: 'none' })
  }
  const rows = [
    ['应用版本', diagnostics.appVersion],
    ['内容版本', `v${currentTrainingContentBundle.releaseVersion}`],
    ['联网服务', account.networkEnabled ? '已配置' : '纯本地模式'],
    ['账号状态', account.authType === 'wechat' ? '已登录微信' : '游客'],
    ['同步状态', account.syncState === 'synced' ? '已同步' : account.syncState === 'pending' ? '等待同步' : '仅本机'],
    ['网络类型', diagnostics.networkType],
    ['待发送错误报告', String(diagnostics.pendingReports)],
    ['最近报告编号', diagnostics.latestReportId ?? '暂无'],
  ]
  return <View className='diagnostics-page'>
    <View className='diagnostics-intro'><Text className='diagnostics-title'>运行诊断</Text><Text className='diagnostics-copy'>用于协助定位封测问题。报告不包含主动表达、登录凭证或请求正文。</Text></View>
    <View className='diagnostics-card'>{rows.map(([label, value]) => <View className='diagnostics-row' key={label}><Text>{label}</Text><Text selectable>{value}</Text></View>)}</View>
    {account.networkEnabled && <Button className='microly-button diagnostics-action' loading={busy} disabled={busy} onClick={retry}>重新发送错误报告</Button>}
  </View>
}
