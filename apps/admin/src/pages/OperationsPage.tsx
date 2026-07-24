import { App, Button, Card, Col, Drawer, Empty, Input, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { AdminOperations } from '@microly/api-contract'

import { adminApi } from '../api'
import { useAuth } from '../auth'
import { PageError, PageLoading } from '../components/PageState'
import { PageHeader } from '../components/PageHeader'
import { queryKeys } from '../query-client'

type Issue = AdminOperations['issues'][number]
const statusLabels = { new: '待处理', in_progress: '处理中', resolved: '已解决' } as const
const statusColors = { new: 'red', in_progress: 'gold', resolved: 'green' } as const
const severityLabels = { warning: '警告', error: '错误', fatal: '严重' } as const
const severityColors = { warning: 'gold', error: 'orange', fatal: 'red' } as const
const serviceLabels = { ok: '正常', disabled: '未启用', unavailable: '不可用' } as const

export default function OperationsPage() {
  const { token } = useAuth()
  const [search, setSearch] = useSearchParams()
  const window = search.get('window') === '1h' ? '1h' : search.get('window') === '7d' ? '7d' : '24h'
  const query = useQuery({ queryKey: queryKeys.operations(window), queryFn: () => adminApi.getOperations(token, window), refetchInterval: 60_000 })
  const queryClient = useQueryClient()
  const { notification, message } = App.useApp()
  const [selected, setSelected] = useState<Issue | null>(null)
  const [status, setStatus] = useState<Issue['status']>('new')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (query.isError) notification.error({ message: '运行状态加载失败', description: query.error.message, key: 'operations-error' })
  }, [notification, query.error, query.isError])
  const mutation = useMutation({
    mutationFn: () => adminApi.updateClientError(token, selected!.fingerprint, status, note.trim() || null),
    onSuccess: async () => {
      message.success('处理状态已更新'); setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] })
    },
    onError: (cause) => notification.error({ message: '更新失败', description: cause.message }),
  })
  const openIssue = (issue: Issue) => { setSelected(issue); setStatus(issue.status); setNote(issue.internalNote ?? '') }
  const serviceCards = query.data ? [
    ['API 进程', query.data.services.process], ['数据库', query.data.services.database],
    ['课程内容', query.data.services.content], ['AI 服务', query.data.services.ai],
  ] as const : []
  return <section>
    <PageHeader eyebrow="封测保障" title="运行状态" description="查看隐私安全的客户端错误聚合与核心服务状态，不展示用户输入或敏感凭证。" extra={<Segmented value={window} options={[{ label: '近 1 小时', value: '1h' }, { label: '近 24 小时', value: '24h' }, { label: '近 7 天', value: '7d' }]} onChange={(value) => setSearch({ window: value })} />} />
    {query.isLoading && <PageLoading rows={8} />}
    {query.isError && <PageError onRetry={() => void query.refetch()} />}
    {query.data && <>
      <Row gutter={[14, 14]}>{serviceCards.map(([label, value]) => <Col xs={12} lg={6} key={label}><Card className="service-card"><Typography.Text type="secondary">{label}</Typography.Text><div><span className={`service-dot ${value}`} /><Typography.Title level={4}>{serviceLabels[value]}</Typography.Title></div></Card></Col>)}</Row>
      <Row gutter={[14, 14]} className="dashboard-row">
        <Col xs={12} lg={6}><Card><Statistic title="错误报告" value={query.data.summary.total} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="待处理指纹" value={query.data.summary.unresolved} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="影响账号数" value={query.data.summary.affectedAccounts} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="告警状态" value={{ normal: '正常', attention: '注意', critical: '严重' }[query.data.summary.level]} styles={{ content: { color: query.data.summary.level === 'critical' ? '#cf3f4f' : query.data.summary.level === 'attention' ? '#c17a12' : '#26815f' } }} /></Card></Col>
      </Row>
      <Card className="api-runtime-card"><Space size="large" wrap>
        <Statistic title="API 请求" value={query.data.api.requests} />
        <Statistic title="5xx 错误率" value={query.data.api.errorRate * 100} precision={2} suffix="%" />
        <Statistic title="P50 延迟" value={query.data.api.latencyP50 ?? 0} precision={0} suffix="ms" />
        <Statistic title="P95 延迟" value={query.data.api.latencyP95 ?? 0} precision={0} suffix="ms" />
      </Space></Card>
      <Row gutter={[16, 16]} className="dashboard-row">
        <Col xs={24} xl={14}><Card title="错误趋势">{query.data.daily.length ? <Table size="small" pagination={false} rowKey="time" dataSource={query.data.daily} columns={[{ title: '时间', dataIndex: 'time' }, { title: '警告', dataIndex: 'warnings' }, { title: '错误', dataIndex: 'errors' }, { title: '严重', dataIndex: 'fatals' }]} /> : <Empty description="当前窗口没有错误报告" />}</Card></Col>
        <Col xs={24} xl={10}><Space direction="vertical" size="middle" className="operations-rankings">
          <Card title="影响页面"><Table size="small" pagination={false} rowKey="page" dataSource={query.data.pages} columns={[{ title: '页面', dataIndex: 'page', ellipsis: true }, { title: '次数', dataIndex: 'count', width: 72 }]} /></Card>
          <Card title="应用版本"><Table size="small" pagination={false} rowKey="appVersion" dataSource={query.data.versions} columns={[{ title: '版本', dataIndex: 'appVersion' }, { title: '次数', dataIndex: 'count', width: 72 }]} /></Card>
        </Space></Col>
      </Row>
      <Card title="错误指纹" extra={`内容 v${query.data.services.currentContentVersion ?? '—'} · ${query.data.services.activeModelId ?? 'AI 未启用'}`}>
        <Table className="operations-issues-table" rowKey="fingerprint" dataSource={query.data.issues} locale={{ emptyText: <Empty description="没有待分析错误" /> }} onRow={(record) => ({ onClick: () => openIssue(record) })} columns={[
          { title: '级别', dataIndex: 'severity', width: 90, render: (value: Issue['severity']) => <Tag color={severityColors[value]}>{severityLabels[value]}</Tag> },
          { title: '页面', dataIndex: 'page', ellipsis: true },
          { title: '分类', dataIndex: 'category', width: 150 },
          { title: '错误码', dataIndex: 'errorCode', width: 150, render: (value) => value ?? '—' },
          { title: '次数', dataIndex: 'count', width: 75 },
          { title: '影响账号', dataIndex: 'affectedAccounts', width: 100 },
          { title: '最近发生', dataIndex: 'lastSeenAt', width: 180, render: (value) => new Date(value).toLocaleString() },
          { title: '状态', dataIndex: 'status', width: 100, render: (value: Issue['status']) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
        ]} />
      </Card>
    </>}
    <Drawer open={Boolean(selected)} width={480} title="处理错误指纹" onClose={() => setSelected(null)} extra={<Button type="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>保存状态</Button>}>
      {selected && <Space direction="vertical" size="large" className="operations-drawer">
        <div><Typography.Text type="secondary">指纹</Typography.Text><Typography.Paragraph copyable code>{selected.fingerprint}</Typography.Paragraph></div>
        <div><Typography.Text type="secondary">发生位置</Typography.Text><Typography.Paragraph>{selected.page} · {selected.errorCode ?? selected.category}</Typography.Paragraph></div>
        <div><Typography.Text type="secondary">影响范围</Typography.Text><Typography.Paragraph>{selected.count} 次 · {selected.affectedAccounts} 个账号<br />{new Date(selected.firstSeenAt).toLocaleString()} 至 {new Date(selected.lastSeenAt).toLocaleString()}</Typography.Paragraph></div>
        <div><Typography.Text strong>处理状态</Typography.Text><Select className="operations-status-select" value={status} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} onChange={setStatus} /></div>
        <div><Typography.Text strong>内部备注</Typography.Text><Input.TextArea rows={5} maxLength={500} showCount value={note} placeholder="记录定位结论、负责人或处理方式" onChange={(event) => setNote(event.target.value)} /></div>
        <Typography.Paragraph type="secondary">客户端仅上报安全分类和不可逆指纹，因此这里不会显示原始错误正文或用户输入。</Typography.Paragraph>
      </Space>}
    </Drawer>
  </section>
}
