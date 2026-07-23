import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminFeedback } from '@microly/api-contract'
import { App, Button, Descriptions, Drawer, Empty, Form, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { adminApi } from '../api'
import { useAuth } from '../auth'
import { PageError } from '../components/PageState'
import { PageHeader } from '../components/PageHeader'
import { queryKeys } from '../query-client'

const statusLabels = { new: '待处理', in_progress: '处理中', resolved: '已解决', dismissed: '已忽略' } as const
const statusColors = { new: 'gold', in_progress: 'blue', resolved: 'green', dismissed: 'default' } as const
const categoryLabels = { content_error: '内容错误', product_suggestion: '产品建议', inappropriate_content: '不当内容' } as const
const statuses = Object.keys(statusLabels) as AdminFeedback['status'][]
const categories = Object.keys(categoryLabels) as AdminFeedback['category'][]

export default function FeedbackPage() {
  const { token } = useAuth()
  const [search, setSearch] = useSearchParams()
  const queryClient = useQueryClient()
  const { message, notification } = App.useApp()
  const [selected, setSelected] = useState<AdminFeedback | null>(null)
  const [note, setNote] = useState('')
  const status = statuses.includes(search.get('status') as AdminFeedback['status']) ? search.get('status') as AdminFeedback['status'] : undefined
  const category = categories.includes(search.get('category') as AdminFeedback['category']) ? search.get('category') as AdminFeedback['category'] : undefined
  const pageValue = Number(search.get('page'))
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1
  const filters = useMemo(() => ({ status, category, page, pageSize: 20 }), [category, page, status])
  const query = useQuery({ queryKey: queryKeys.feedback(filters), queryFn: () => adminApi.getFeedback(token, filters) })
  useEffect(() => {
    if (!selected) return
    const latest = query.data?.items.find((item) => item.id === selected.id)
    if (latest) setSelected(latest)
  }, [query.data, selected])

  const mutation = useMutation({
    mutationFn: (nextStatus: AdminFeedback['status']) => {
      if (!selected) throw new Error('请先选择反馈')
      return adminApi.updateFeedback(token, selected.id, nextStatus, note.trim() || null)
    },
    onSuccess: async (value) => {
      setSelected(value)
      setNote(value.internalNote ?? '')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'feedback'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'metrics'] }),
      ])
      message.success('反馈状态已更新')
    },
    onError: (cause) => notification.error({ message: '反馈更新失败', description: cause.message }),
  })
  const updateFilters = (next: { status?: string; category?: string; page?: number }) => {
    const params = new URLSearchParams()
    const nextStatus = next.status === undefined ? status : next.status || undefined
    const nextCategory = next.category === undefined ? category : next.category || undefined
    if (nextStatus) params.set('status', nextStatus)
    if (nextCategory) params.set('category', nextCategory)
    const nextPage = next.page ?? 1
    if (nextPage > 1) params.set('page', String(nextPage))
    setSearch(params)
  }
  return <section>
    <PageHeader
      eyebrow="用户声音"
      title="反馈处理"
      description="反馈正文仅用于处理问题，不与主动表达草稿关联。"
      extra={<Space wrap>
        <Select allowClear placeholder="全部状态" value={status} style={{ width: 140 }} options={statuses.map((value) => ({ value, label: statusLabels[value] }))} onChange={(value) => updateFilters({ status: value })} />
        <Select allowClear placeholder="全部类型" value={category} style={{ width: 150 }} options={categories.map((value) => ({ value, label: categoryLabels[value] }))} onChange={(value) => updateFilters({ category: value })} />
      </Space>}
    />
    {query.isError ? <PageError onRetry={() => void query.refetch()} /> : <Table<AdminFeedback>
      rowKey="id"
      loading={query.isLoading}
      dataSource={query.data?.items ?? []}
      locale={{ emptyText: <Empty description="当前筛选条件下没有反馈" /> }}
      onRow={(record) => ({ onClick: () => { setSelected(record); setNote(record.internalNote ?? '') } })}
      rowClassName={(record) => record.id === selected?.id ? 'selected-table-row' : ''}
      pagination={{ current: page, pageSize: 20, total: query.data?.total ?? 0, showSizeChanger: false, showTotal: (total) => `共 ${total} 条`, onChange: (next) => updateFilters({ page: next }) }}
      columns={[
        { title: '状态', dataIndex: 'status', width: 110, render: (value: AdminFeedback['status']) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
        { title: '类型', dataIndex: 'category', width: 130, render: (value: AdminFeedback['category']) => categoryLabels[value] },
        { title: '反馈内容', dataIndex: 'detail', ellipsis: true },
        { title: '训练上下文', width: 220, render: (_, record) => record.sessionId ? `${record.sessionId} · v${record.contentVersion}` : '—' },
        { title: '提交时间', dataIndex: 'createdAt', width: 190, render: (value: string) => new Date(value).toLocaleString() },
      ]}
    />}
    <Drawer width={520} title={selected ? categoryLabels[selected.category] : '反馈详情'} open={Boolean(selected)} onClose={() => setSelected(null)} destroyOnHidden>
      {selected && <>
        <Space className="feedback-drawer-heading"><Tag color={statusColors[selected.status]}>{statusLabels[selected.status]}</Tag><Typography.Text type="secondary">{new Date(selected.createdAt).toLocaleString()}</Typography.Text></Space>
        <Typography.Paragraph className="feedback-detail-copy">{selected.detail}</Typography.Paragraph>
        <Descriptions size="small" column={1} bordered items={[
          { key: 'session', label: '训练', children: selected.sessionId ?? '无训练上下文' },
          { key: 'version', label: '内容版本', children: selected.contentVersion ? `v${selected.contentVersion}` : '—' },
          { key: 'resolved', label: '结束时间', children: selected.resolvedAt ? new Date(selected.resolvedAt).toLocaleString() : '—' },
        ]} />
        <Form layout="vertical" className="feedback-note-form">
          <Form.Item label="内部备注" extra={`${note.length}/500`}><Input.TextArea rows={7} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></Form.Item>
        </Form>
        <Space wrap>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate('in_progress')}>{selected.status === 'resolved' || selected.status === 'dismissed' ? '重新打开' : '标记处理中'}</Button>
          <Button type="primary" loading={mutation.isPending} onClick={() => mutation.mutate('resolved')}>标记已解决</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate('dismissed')}>忽略</Button>
        </Space>
      </>}
    </Drawer>
  </section>
}
