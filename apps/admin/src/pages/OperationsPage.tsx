import { App, Alert, Button, Card, Col, Drawer, Empty, Form, Input, Modal, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag, Typography } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
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
const deploymentLabels = { deploying: '发布中', healthy: '健康', failed: '失败', rolled_back: '已回滚' } as const
const backupLabels = { scheduled: '定时', pre_release: '发布前', manual: '手动' } as const

export default function OperationsPage() {
  const { token } = useAuth()
  const [search, setSearch] = useSearchParams()
  const window = search.get('window') === '1h' ? '1h' : search.get('window') === '7d' ? '7d' : '24h'
  const query = useQuery({ queryKey: queryKeys.operations(window), queryFn: () => adminApi.getOperations(token, window), refetchInterval: 60_000 })
  const runtimeQuery = useQuery({ queryKey: queryKeys.runtimeConfig, queryFn: () => adminApi.getRuntimeConfig(token) })
  const deploymentQuery = useQuery({ queryKey: queryKeys.deployments, queryFn: () => adminApi.getDeployments(token) })
  const backupQuery = useQuery({ queryKey: queryKeys.backups, queryFn: () => adminApi.getBackups(token) })
  const queryClient = useQueryClient()
  const { notification, message } = App.useApp()
  const [selected, setSelected] = useState<Issue | null>(null)
  const [status, setStatus] = useState<Issue['status']>('new')
  const [note, setNote] = useState('')
  const [runtimeOpen, setRuntimeOpen] = useState(false)
  const [runtimeForm] = Form.useForm()
  useEffect(() => {
    if (query.isError) notification.error({ message: '运行状态加载失败', description: query.error.message, key: 'operations-error' })
  }, [notification, query.error, query.isError])
  const mutation = useMutation({
    mutationFn: () => adminApi.updateClientError(token, selected!.fingerprint, status, note.trim() || null),
    onSuccess: async () => { message.success('处理状态已更新'); setSelected(null); await queryClient.invalidateQueries({ queryKey: ['admin', 'operations'] }) },
    onError: (cause) => notification.error({ message: '更新失败', description: cause.message }),
  })
  const runtimeMutation = useMutation({
    mutationFn: (value: Omit<Parameters<typeof adminApi.updateRuntimeConfig>[1], 'revision'>) => adminApi.updateRuntimeConfig(token, { ...value, revision: runtimeQuery.data!.revision }),
    onSuccess: async () => { message.success('运行配置已更新'); setRuntimeOpen(false); await queryClient.invalidateQueries({ queryKey: queryKeys.runtimeConfig }) },
    onError: (cause) => notification.error({ message: '运行配置更新失败', description: cause.message }),
  })
  const openIssue = (issue: Issue) => { setSelected(issue); setStatus(issue.status); setNote(issue.internalNote ?? '') }
  const openRuntime = () => {
    const value = runtimeQuery.data
    if (!value) return
    runtimeForm.setFieldsValue({ minimumSupportedVersion: value.minimumSupportedVersion, maintenanceActive: value.maintenance.active, maintenanceMessage: value.maintenance.message, ...value.features, reason: '' })
    setRuntimeOpen(true)
  }
  const saveRuntime = async () => {
    const value = await runtimeForm.validateFields()
    await runtimeMutation.mutateAsync({
      minimumSupportedVersion: value.minimumSupportedVersion,
      maintenance: { active: Boolean(value.maintenanceActive), message: value.maintenanceActive ? value.maintenanceMessage?.trim() || null : null },
      features: { wechatLogin: Boolean(value.wechatLogin), accountSync: Boolean(value.accountSync), aiEvaluation: Boolean(value.aiEvaluation), feedback: Boolean(value.feedback) },
      reason: value.reason,
    })
  }
  const checklist = useMemo(() => {
    if (!query.data) return []
    const latestBackup = backupQuery.data?.items.find((item) => item.status === 'succeeded')
    const latestDeployment = deploymentQuery.data?.items[0]
    return [
      { label: '数据库可用', ok: query.data.services.database === 'ok', blocking: true },
      { label: '已发布内容通过结构检查', ok: query.data.services.content === 'ok', blocking: true },
      { label: '迁移为最新版本', ok: latestDeployment?.migrationVersion === '0007_beta_release.sql', blocking: true },
      { label: '48 小时内有成功备份', ok: Boolean(latestBackup && Date.now() - Date.parse(latestBackup.completedAt ?? latestBackup.createdAt) < 48 * 60 * 60 * 1000), blocking: true },
      { label: '当前部署健康', ok: latestDeployment?.status === 'healthy', blocking: true },
      { label: '没有严重运行告警', ok: query.data.summary.level !== 'critical', blocking: false },
      { label: 'AI 服务可用或主动关闭', ok: query.data.services.ai !== 'unavailable', blocking: false },
      { label: '没有待处理客户端错误', ok: query.data.summary.unresolved === 0, blocking: false },
      { label: '没有待处理用户反馈', ok: query.data.summary.pendingFeedback === 0, blocking: false },
    ]
  }, [backupQuery.data, deploymentQuery.data, query.data])
  const blockers = checklist.filter((item) => item.blocking && !item.ok)
  const serviceCards = query.data ? [['API 进程', query.data.services.process], ['数据库', query.data.services.database], ['课程内容', query.data.services.content], ['AI 服务', query.data.services.ai]] as const : []
  const loading = query.isLoading || runtimeQuery.isLoading || deploymentQuery.isLoading || backupQuery.isLoading
  const failed = query.isError || runtimeQuery.isError || deploymentQuery.isError || backupQuery.isError
  return <section>
    <PageHeader eyebrow="封测保障" title="封测发布" description="统一查看生产版本、备份、运行开关、发布检查与隐私安全的客户端错误。" extra={<Space><Segmented value={window} options={[{ label: '近 1 小时', value: '1h' }, { label: '近 24 小时', value: '24h' }, { label: '近 7 天', value: '7d' }]} onChange={(value) => setSearch({ window: value })} /><Button type="primary" onClick={openRuntime} disabled={!runtimeQuery.data}>运行开关</Button></Space>} />
    {loading && <PageLoading rows={8} />}
    {failed && <PageError onRetry={() => { void query.refetch(); void runtimeQuery.refetch(); void deploymentQuery.refetch(); void backupQuery.refetch() }} />}
    {query.data && runtimeQuery.data && !loading && <>
      <Alert className="release-readiness-alert" type={blockers.length ? 'error' : 'success'} showIcon message={blockers.length ? `${blockers.length} 项发布阻断待处理` : '发布检查通过'} description={<Space wrap>{checklist.map((item) => <Tag key={item.label} color={item.ok ? 'green' : item.blocking ? 'red' : 'gold'}>{item.ok ? '通过' : item.blocking ? '阻断' : '提示'} · {item.label}</Tag>)}</Space>} />
      {query.data.alerts.length > 0 && <Alert className="release-readiness-alert" type="error" showIcon message={`${query.data.alerts.length} 个运行告警尚未恢复`} description={<Space wrap>{query.data.alerts.map((item) => <Tag color="red" key={item.key}>{item.key} · {new Date(item.updatedAt).toLocaleString()}</Tag>)}</Space>} />}
      <Row gutter={[14, 14]}>{serviceCards.map(([label, value]) => <Col xs={12} lg={6} key={label}><Card className="service-card"><Typography.Text type="secondary">{label}</Typography.Text><div><span className={`service-dot ${value}`} /><Typography.Title level={4}>{serviceLabels[value]}</Typography.Title></div></Card></Col>)}</Row>
      <Row gutter={[14, 14]} className="dashboard-row">
        <Col xs={12} lg={4}><Card><Statistic title="API 版本" value={runtimeQuery.data.apiVersion} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="内容版本" value={query.data.services.currentContentVersion ?? '—'} prefix="v" /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="迁移版本" value={deploymentQuery.data?.items[0]?.migrationVersion ?? '—'} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="最低小程序" value={runtimeQuery.data.minimumSupportedVersion} /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="运行配置" value={runtimeQuery.data.revision} prefix="r" /></Card></Col>
        <Col xs={12} lg={4}><Card><Statistic title="环境" value={runtimeQuery.data.environment === 'production' ? '生产' : runtimeQuery.data.environment} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]} className="dashboard-row">
        <Col xs={24} xl={14}><Card title="最近发布"><Table size="small" pagination={false} rowKey="id" dataSource={deploymentQuery.data?.items.slice(0, 5)} locale={{ emptyText: <Empty description="尚无部署记录" /> }} columns={[
          { title: '版本', dataIndex: 'appVersion' }, { title: '镜像', dataIndex: 'imageTag' }, { title: '迁移', dataIndex: 'migrationVersion', render: (value) => value ?? '—' },
          { title: '内容', dataIndex: 'contentVersion', render: (value) => value ? `v${value}` : '—' },
          { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'healthy' ? 'green' : value === 'failed' ? 'red' : 'gold'}>{deploymentLabels[value as keyof typeof deploymentLabels]}</Tag> },
          { title: '时间', dataIndex: 'createdAt', render: (value) => new Date(value).toLocaleString() },
        ]} /></Card></Col>
        <Col xs={24} xl={10}><Card title="最近备份"><Table size="small" pagination={false} rowKey="id" dataSource={backupQuery.data?.items.slice(0, 5)} locale={{ emptyText: <Empty description="尚无备份记录" /> }} columns={[
          { title: '类型', dataIndex: 'kind', render: (value) => backupLabels[value as keyof typeof backupLabels] },
          { title: '状态', dataIndex: 'status', render: (value) => <Tag color={value === 'succeeded' ? 'green' : value === 'failed' ? 'red' : 'blue'}>{value === 'succeeded' ? '成功' : value === 'failed' ? '失败' : '进行中'}</Tag> },
          { title: '大小', dataIndex: 'sizeBytes', render: (value) => value === null ? '—' : `${(value / 1024 / 1024).toFixed(1)} MB` },
          { title: '恢复演练', dataIndex: 'restoreVerifiedAt', render: (value) => value ? new Date(value).toLocaleDateString() : '未验证' },
        ]} /></Card></Col>
      </Row>
      <Card className="api-runtime-card"><Space size="large" wrap><Statistic title="API 请求" value={query.data.api.requests} /><Statistic title="5xx 错误率" value={query.data.api.errorRate * 100} precision={2} suffix="%" /><Statistic title="P50 延迟" value={query.data.api.latencyP50 ?? 0} precision={0} suffix="ms" /><Statistic title="P95 延迟" value={query.data.api.latencyP95 ?? 0} precision={0} suffix="ms" /></Space></Card>
      <Card title="错误指纹" extra={`最低小程序版本 ${runtimeQuery.data.minimumSupportedVersion}`}>
        <Table className="operations-issues-table" rowKey="fingerprint" dataSource={query.data.issues} locale={{ emptyText: <Empty description="没有待分析错误" /> }} onRow={(record) => ({ onClick: () => openIssue(record) })} columns={[
          { title: '级别', dataIndex: 'severity', width: 90, render: (value: Issue['severity']) => <Tag color={severityColors[value]}>{severityLabels[value]}</Tag> },
          { title: '页面', dataIndex: 'page', ellipsis: true }, { title: '分类', dataIndex: 'category', width: 150 },
          { title: '错误码', dataIndex: 'errorCode', width: 150, render: (value) => value ?? '—' }, { title: '次数', dataIndex: 'count', width: 75 },
          { title: '影响账号', dataIndex: 'affectedAccounts', width: 100 }, { title: '最近发生', dataIndex: 'lastSeenAt', width: 180, render: (value) => new Date(value).toLocaleString() },
          { title: '状态', dataIndex: 'status', width: 100, render: (value: Issue['status']) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
        ]} />
      </Card>
    </>}
    <Modal open={runtimeOpen} title="运行开关" okText="保存配置" confirmLoading={runtimeMutation.isPending} onCancel={() => setRuntimeOpen(false)} onOk={() => void saveRuntime()}>
      <Form form={runtimeForm} layout="vertical">
        <Form.Item name="minimumSupportedVersion" label="最低支持小程序版本" rules={[{ required: true }, { pattern: /^\d+\.\d+\.\d+$/, message: '请输入 x.y.z 版本号' }]}><Input /></Form.Item>
        <Form.Item name="maintenanceActive" label="维护模式" valuePropName="checked"><Switch /></Form.Item>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.maintenanceActive !== current.maintenanceActive}>{({ getFieldValue }) => getFieldValue('maintenanceActive') ? <Form.Item name="maintenanceMessage" label="维护提示" rules={[{ required: true }]}><Input maxLength={200} showCount /></Form.Item> : null}</Form.Item>
        <Typography.Text strong>联网能力</Typography.Text>
        <Row gutter={12}>{([['wechatLogin', '微信登录'], ['accountSync', '账号同步'], ['aiEvaluation', 'AI 点评'], ['feedback', '意见反馈']] as const).map(([name, label]) => <Col span={12} key={name}><Form.Item name={name} label={label} valuePropName="checked"><Switch /></Form.Item></Col>)}</Row>
        <Form.Item name="reason" label="变更原因" rules={[{ required: true, min: 2 }]}><Input.TextArea maxLength={200} showCount rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Drawer open={Boolean(selected)} width={480} title="处理错误指纹" onClose={() => setSelected(null)} extra={<Button type="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>保存状态</Button>}>
      {selected && <Space direction="vertical" size="large" className="operations-drawer"><div><Typography.Text type="secondary">指纹</Typography.Text><Typography.Paragraph copyable code>{selected.fingerprint}</Typography.Paragraph></div><div><Typography.Text type="secondary">发生位置</Typography.Text><Typography.Paragraph>{selected.page} · {selected.errorCode ?? selected.category}</Typography.Paragraph></div><div><Typography.Text strong>处理状态</Typography.Text><Select className="operations-status-select" value={status} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} onChange={setStatus} /></div><div><Typography.Text strong>内部备注</Typography.Text><Input.TextArea rows={5} maxLength={500} showCount value={note} onChange={(event) => setNote(event.target.value)} /></div></Space>}
    </Drawer>
  </section>
}
