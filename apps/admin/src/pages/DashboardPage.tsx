import { lazy, Suspense, useEffect } from 'react'
import { App, Card, Col, Empty, Row, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'

import { adminApi } from '../api'
import { useAuth } from '../auth'
import { PageError, PageLoading } from '../components/PageState'
import { PageHeader } from '../components/PageHeader'
import { queryKeys } from '../query-client'

const MetricsChart = lazy(() => import('../components/MetricsChart'))

const funnelLabels: Record<string, string> = {
  app_open: '首次打开', onboarding_view: '看到引导', training_start: '开始训练',
  option_select: '确认选项', training_complete: '完成训练', wechat_login_success: '微信登录',
}
const feedbackLabels = { new: '待处理', in_progress: '处理中', resolved: '已解决', dismissed: '已忽略' } as const
const feedbackColors = { new: 'gold', in_progress: 'blue', resolved: 'green', dismissed: 'default' } as const

export default function DashboardPage() {
  const { token } = useAuth()
  const [search, setSearch] = useSearchParams()
  const window = search.get('window') === '30d' ? '30d' : '7d'
  const query = useQuery({ queryKey: queryKeys.metrics(window), queryFn: () => adminApi.getMetrics(token, window) })
  const { notification } = App.useApp()
  useEffect(() => {
    if (query.isError) notification.error({ message: '指标加载失败', description: query.error.message, key: 'metrics-error' })
  }, [notification, query.error, query.isError])
  return <section>
    <PageHeader
      eyebrow="运营概览"
      title="学习漏斗"
      description="观察新用户从打开到登录保存的关键流失节点。"
      extra={<Segmented value={window} options={[{ label: '近 7 天', value: '7d' }, { label: '近 30 天', value: '30d' }]} onChange={(value) => setSearch({ window: value })} />}
    />
    {query.isLoading && <PageLoading rows={8} />}
    {query.isError && <PageError onRetry={() => void query.refetch()} />}
    {query.data && <>
      <Row gutter={[14, 14]}>{query.data.funnel.map((stage, index) => <Col xs={12} md={8} xl={4} key={stage.name}>
        <Card className="metric-card"><Statistic title={`${index + 1}. ${funnelLabels[stage.name]}`} value={stage.accounts} /><Typography.Text type="secondary">
          {stage.conversionRate === null ? '窗口内首次用户' : `上一步转化 ${(stage.conversionRate * 100).toFixed(1)}%`}
        </Typography.Text></Card>
      </Col>)}</Row>
      <Row gutter={[16, 16]} className="dashboard-row">
        <Col xs={24} xl={16}><Card title="训练趋势" extra="UTC 自然日">
          {query.data.daily.length ? <Suspense fallback={<PageLoading rows={4} />}><MetricsChart daily={query.data.daily} /></Suspense> : <Empty description="窗口内还没有训练事件" />}
        </Card></Col>
        <Col xs={24} xl={8}><Card title="反馈待办" extra={<Statistic value={query.data.feedback.byStatus.new + query.data.feedback.byStatus.in_progress} styles={{ content: { color: '#5b5bd6', fontSize: 24 } }} />}>
          <Space orientation="vertical" size="large" className="feedback-summary">{Object.entries(feedbackLabels).map(([status, label]) => <div key={status}><Tag color={feedbackColors[status as keyof typeof feedbackColors]}>{label}</Tag><strong>{query.data.feedback.byStatus[status as keyof typeof query.data.feedback.byStatus]}</strong></div>)}</Space>
        </Card></Col>
      </Row>
      <Card title="训练表现" extra="按完成数排序">
        <Table rowKey="sessionId" pagination={false} locale={{ emptyText: <Empty description="窗口内还没有可比较的训练" /> }} dataSource={query.data.sessions} columns={[
          { title: '训练 ID', dataIndex: 'sessionId' },
          { title: '开始', dataIndex: 'starts', width: 120 },
          { title: '完成', dataIndex: 'completions', width: 120 },
          { title: '完成率', dataIndex: 'completionRate', width: 140, render: (value: number) => `${(value * 100).toFixed(1)}%` },
        ]} />
      </Card>
    </>}
  </section>
}
