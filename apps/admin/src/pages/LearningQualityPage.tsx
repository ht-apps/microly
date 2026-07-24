import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ContentQualityIssue } from '@microly/api-contract'
import { App, Button, Card, Col, Descriptions, Drawer, Empty, Form, Input, Modal, Progress, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'

import { adminApi } from '../api'
import { useAuth } from '../auth'
import { PageHeader } from '../components/PageHeader'
import { PageError, PageLoading } from '../components/PageState'
import { queryKeys } from '../query-client'

const RetentionChart = lazy(() => import('../components/LearningRetentionChart'))

const rateText = (value: number | null, empty = '样本不足') => value === null ? empty : `${(value * 100).toFixed(1)}%`
const durationText = (value: number | null) => value === null ? '—' : `${Math.floor(value / 60_000)}分${Math.round((value % 60_000) / 1000)}秒`
const cardTypeLabels = { scenario: '情境', choice: '选择', feedback: '反馈', principle: '原则', practice: '主动表达', completion: '完成' } as const
const statusLabels = { open: '待处理', in_progress: '处理中', resolved: '已解决', dismissed: '已忽略' } as const
const statusColors = { open: 'gold', in_progress: 'blue', resolved: 'green', dismissed: 'default' } as const
const signalLabels = {
  low_completion: '完成率偏低', duration_outlier: '时长异常', low_practice: '主动练习偏低',
  high_card_exit: '卡片退出偏高', weak_review_variant: '变体表现偏弱', content_feedback: '内容反馈',
} as const

export default function LearningQualityPage() {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const { notification } = App.useApp()
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const window: '7d' | '30d' = search.get('window') === '7d' ? '7d' : '30d'
  const releaseVersion = Number(search.get('releaseVersion')) || undefined
  const catalogId = search.get('catalogId') || undefined
  const sessionId = search.get('sessionId') || undefined
  const filters = useMemo(() => ({ window, releaseVersion, catalogId, sessionId }), [window, releaseVersion, catalogId, sessionId])
  const query = useQuery({ queryKey: queryKeys.learningQuality(filters), queryFn: () => adminApi.getLearningQuality(token, filters) })
  const [editingIssue, setEditingIssue] = useState<ContentQualityIssue | null>(null)
  const [issueStatus, setIssueStatus] = useState<ContentQualityIssue['status']>('in_progress')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (query.isError) notification.error({ message: '学习质量指标加载失败', description: query.error.message, key: 'learning-quality-error' })
  }, [notification, query.error, query.isError])

  const updateIssue = useMutation({
    mutationFn: () => adminApi.updateLearningQualityIssue(token, editingIssue!.issueKey, issueStatus, note.trim() || null),
    onSuccess: async () => {
      setEditingIssue(null); setNote('')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'learning-quality'] })
      notification.success({ message: '处理状态已更新' })
    },
    onError: (error) => notification.error({ message: '更新失败', description: error.message }),
  })

  const updateSearch = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(search)
    Object.entries(patch).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key))
    setSearch(next)
  }
  const selectedSession = query.data?.sessions.find((item) => item.sessionId === sessionId) ?? null

  return <section className="learning-quality-page">
    <PageHeader eyebrow="封测学习验证" title="学习质量" description="用成熟 cohort 和安全行为数据定位流失、复习效果与需要人工优化的训练。" extra={
      <Segmented value={window} options={[{ label: '近 7 天', value: '7d' }, { label: '近 30 天', value: '30d' }]} onChange={(value) => updateSearch({ window: value })} />
    } />
    {query.isLoading && <PageLoading rows={9} />}
    {query.isError && <PageError onRetry={() => void query.refetch()} />}
    {query.data && <>
      <Card className="quality-filters"><Space wrap>
        <Select aria-label="发布版本" value={query.data.selectedReleaseVersion} options={query.data.filters.releases.map((item) => ({ value: item.releaseVersion, label: `发布 v${item.releaseVersion}` }))} onChange={(value) => updateSearch({ releaseVersion: String(value), catalogId: undefined, sessionId: undefined })} />
        <Select aria-label="章节" allowClear placeholder="全部章节" value={catalogId} options={query.data.filters.catalogs.map((item) => ({ value: item.catalogId, label: item.title }))} onChange={(value) => updateSearch({ catalogId: value, sessionId: undefined })} />
        <Select aria-label="训练" showSearch allowClear optionFilterProp="label" placeholder="全部训练" value={sessionId} options={query.data.filters.sessions.filter((item) => !catalogId || item.catalogId === catalogId).map((item) => ({ value: item.sessionId, label: item.title }))} onChange={(value) => updateSearch({ sessionId: value })} />
        <Typography.Text type="secondary">数据覆盖起点：{query.data.coverageStartedAt ? new Date(query.data.coverageStartedAt).toLocaleString() : '尚无新版埋点'}</Typography.Text>
      </Space></Card>

      <Row gutter={[14, 14]} className="quality-summary">
        {[
          ['首训开始率', rateText(query.data.summary.firstTrainingStartRate), '目标 ≥ 70%'],
          ['首训完成率', rateText(query.data.summary.firstTrainingCompletionRate), '目标 ≥ 65%'],
          ['D1 留存', rateText(query.data.summary.d1RetentionRate, '样本未成熟'), `成熟样本 ${query.data.summary.d1EligibleAccounts}`],
          ['7 日三练率', rateText(query.data.summary.sevenDayThreePracticeRate, '样本未成熟'), `成熟样本 ${query.data.summary.sevenDayEligibleAccounts}`],
          ['主动练习率', rateText(query.data.summary.activePracticeRate), '目标 ≥ 25%'],
          ['到期复习完成率', rateText(query.data.summary.dueReviewCompletionRate), `已知到期 ${query.data.summary.dueReviewOccurrences}`],
          ['WEL', String(query.data.summary.welAccounts), '本周有效学习账号'],
          ['待优化', String(query.data.summary.openIssueCount), '只生成提示，不自动改内容'],
        ].map(([title, value, hint]) => <Col xs={12} md={8} xl={6} key={title}><Card className="metric-card"><Statistic title={title} value={value} /><Typography.Text type="secondary">{hint}</Typography.Text></Card></Col>)}
      </Row>

      <Row gutter={[16, 16]} className="dashboard-row">
        <Col xs={24} xl={16}><Card title="首训与留存趋势" extra="只展示已成熟 cohort">
          {query.data.retentionTrend.length ? <Suspense fallback={<PageLoading rows={4} />}><RetentionChart data={query.data.retentionTrend} /></Suspense> : <Empty description="窗口内还没有成熟 cohort" />}
        </Card></Col>
        <Col xs={24} xl={8}><Card title="训练耗时与练习">
          <Space orientation="vertical" size="large" className="quality-side-summary">
            <Statistic title="中位活跃时长" value={durationText(query.data.summary.medianDurationMs)} />
            <div><Typography.Text>主动练习</Typography.Text><Progress percent={Math.round((query.data.summary.activePracticeRate ?? 0) * 100)} /></div>
            <div><Typography.Text>到期复习</Typography.Text><Progress percent={Math.round((query.data.summary.dueReviewCompletionRate ?? 0) * 100)} strokeColor="#36a678" /></div>
          </Space>
        </Card></Col>
      </Row>

      <Card className="quality-performance-card" title="训练表现" extra={<Space size="middle"><Typography.Text type="secondary">点击一行查看六卡片和版本明细</Typography.Text><Tag bordered={false}>判定门槛 10 次</Tag></Space>}>
        <Table className="quality-performance-table" size="middle" tableLayout="fixed" scroll={{ x: 1320 }} rowKey="sessionId" pagination={{ pageSize: 8, showSizeChanger: false, showTotal: (total) => `共 ${total} 组训练` }} dataSource={query.data.sessions} locale={{ emptyText: <Empty description="当前筛选范围没有新版训练数据" /> }} onRow={(record) => ({ onClick: () => updateSearch({ sessionId: record.sessionId }) })} columns={[
          { title: '训练', width: 260, fixed: 'left', render: (_, row) => <div className="quality-session-cell"><strong>{row.title}</strong><Typography.Text type="secondary">{row.catalogTitle} · 内容 v{row.contentVersion}</Typography.Text></div> },
          { title: '开始', dataIndex: 'starts', width: 80 },
          { title: '完成率', width: 100, render: (_, row) => row.starts ? <strong>{rateText(row.completionRate, '—')}</strong> : <span className="quality-empty-value">—</span> },
          { title: '中位时长', width: 120, render: (_, row) => <span className={row.medianDurationMs === null ? 'quality-empty-value' : ''}>{durationText(row.medianDurationMs)}</span> },
          { title: '主动练习', width: 100, render: (_, row) => row.completions ? rateText(row.activePracticeRate, '—') : <span className="quality-empty-value">—</span> },
          { title: '主要退出卡片', width: 150, render: (_, row) => row.topExitCard ? <Tag bordered={false} color={(row.topExitCard.exitRate ?? 0) > 0.3 ? 'error' : 'default'}>{cardTypeLabels[row.topExitCard.cardType]} {rateText(row.topExitCard.exitRate, '—')}</Tag> : <span className="quality-empty-value">—</span> },
          { title: '选项评分', width: 230, render: (_, row) => row.optionRatings.recommended + row.optionRatings.risky + row.optionRatings.not_recommended > 0 ? <Space size={4} wrap><Tag bordered={false} color="success">推荐 {row.optionRatings.recommended}</Tag><Tag bordered={false} color="warning">风险 {row.optionRatings.risky}</Tag><Tag bordered={false} color="error">不推荐 {row.optionRatings.not_recommended}</Tag></Space> : <span className="quality-empty-value">—</span> },
          { title: '反馈', width: 80, render: (_, row) => row.feedbackCount ? <Tag bordered={false} color="gold">{row.feedbackCount}</Tag> : <span className="quality-empty-value">0</span> },
          { title: '样本状态', width: 120, render: (_, row) => <div className="quality-sample-cell"><Tag bordered={false} color={row.sampleSufficient ? 'success' : 'default'}>{row.sampleSufficient ? '可判断' : '待积累'}</Tag>{!row.sampleSufficient && <small>还差 {Math.max(0, 10 - row.starts)} 次</small>}</div> },
        ]} />
      </Card>

      <Card title="待优化清单" className="quality-issues-card" extra="阈值只用于封测方向判断">
        <Table rowKey="issueKey" pagination={false} dataSource={query.data.issues} locale={{ emptyText: <Empty description="当前没有达到阈值的质量信号" /> }} columns={[
          { title: '训练', render: (_, row) => <Button type="link" className="quality-table-link" onClick={() => updateSearch({ sessionId: row.sessionId })}>{row.sessionTitle}</Button> },
          { title: '信号', width: 130, render: (_, row) => <Tag color={row.severity === 'critical' ? 'red' : 'gold'}>{signalLabels[row.signal]}</Tag> },
          { title: '说明', dataIndex: 'message' },
          { title: '样本', dataIndex: 'sampleSize', width: 80 },
          { title: '状态', width: 100, render: (_, row) => <Tag color={statusColors[row.status]}>{statusLabels[row.status]}</Tag> },
          { title: '操作', width: 180, render: (_, row) => <Space>
            {row.signal === 'content_feedback' && <Button type="link" onClick={() => navigate('/feedback?status=new&page=1')}>查看反馈</Button>}
            <Button onClick={(event) => { event.stopPropagation(); setEditingIssue(row); setIssueStatus(row.status === 'open' ? 'in_progress' : row.status); setNote(row.internalNote ?? '') }}>处理</Button>
          </Space> },
        ]} />
      </Card>
    </>}

    <Drawer title={selectedSession?.title ?? '训练详情'} size="large" open={Boolean(selectedSession)} onClose={() => updateSearch({ sessionId: undefined })}>
      {selectedSession && <Space orientation="vertical" size="large" className="quality-drawer">
        <Descriptions bordered column={2} items={[
          { key: 'release', label: '发布版本', children: `v${selectedSession.releaseVersion}` },
          { key: 'content', label: '内容版本', children: `v${selectedSession.contentVersion}` },
          { key: 'choice', label: '选项分布', span: 2, children: `推荐 ${selectedSession.optionRatings.recommended} · 有风险 ${selectedSession.optionRatings.risky} · 不推荐 ${selectedSession.optionRatings.not_recommended}` },
          { key: 'review', label: '复习表现', span: 2, children: `原题 ${rateText(selectedSession.originalReviewCorrectRate)}（${selectedSession.originalReviewAnswers}） · 变体 ${rateText(selectedSession.variantReviewCorrectRate)}（${selectedSession.variantReviewAnswers}）` },
        ]} />
        <Card title="六卡片流失"><Table rowKey="cardId" pagination={false} dataSource={selectedSession.cards} columns={[
          { title: '序号', render: (_, row) => row.cardIndex + 1, width: 70 }, { title: '卡片', render: (_, row) => cardTypeLabels[row.cardType] },
          { title: '展示', dataIndex: 'views' }, { title: '成熟样本', dataIndex: 'matureViews' },
          { title: '24h 退出', render: (_, row) => rateText(row.exitRate) },
        ]} /></Card>
        <Card title="发布版本表现"><Table rowKey="releaseVersion" pagination={false} dataSource={selectedSession.versionHistory} columns={[
          { title: '发布', render: (_, row) => `v${row.releaseVersion}` }, { title: '内容版本', render: (_, row) => `v${row.contentVersion}` },
          { title: '开始', dataIndex: 'starts' }, { title: '完成率', render: (_, row) => rateText(row.completionRate) },
          { title: '中位时长', render: (_, row) => durationText(row.medianDurationMs) },
        ]} /></Card>
        <Card title="相关质量问题"><Table rowKey="issueKey" pagination={false} dataSource={query.data?.issues.filter((issue) => issue.sessionId === selectedSession.sessionId) ?? []} locale={{ emptyText: '暂无达到阈值的问题' }} columns={[
          { title: '信号', render: (_, row) => signalLabels[row.signal] },
          { title: '说明', dataIndex: 'message' },
          { title: '状态', render: (_, row) => statusLabels[row.status], width: 90 },
        ]} /></Card>
      </Space>}
    </Drawer>

    <Modal title="处理质量信号" open={Boolean(editingIssue)} confirmLoading={updateIssue.isPending} okText="保存状态" onCancel={() => setEditingIssue(null)} onOk={() => void updateIssue.mutate()} okButtonProps={{ disabled: ['resolved', 'dismissed'].includes(issueStatus) && note.trim().length < 2 }}>
      <Form layout="vertical">
        <Form.Item label="处理状态"><Select value={issueStatus} onChange={setIssueStatus} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Form.Item label="内部备注" required={['resolved', 'dismissed'].includes(issueStatus)}><Input.TextArea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} showCount placeholder="记录判断、修改方向或结束原因" /></Form.Item>
      </Form>
    </Modal>
  </section>
}
