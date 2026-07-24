import { CheckCircleOutlined, CloseCircleOutlined, ExperimentOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons'
import type { AdminContentGenerationJob, AdminSessionOutline } from '@microly/api-contract'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Col, Empty, Form, Input, InputNumber, Progress, Row, Select, Space, Statistic, Steps, Table, Tag, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { adminApi, type ApiError } from '../api'
import { useAuth } from '../auth'
import { CardPreview } from '../components/CardPreview'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/PageState'
import { queryKeys } from '../query-client'

const defaultDifficulties = ['L1', 'L1', 'L2', 'L2', 'L3'] as const
const statusLabel = { queued: '排队中', processing: '生成中', succeeded: '已完成', failed: '失败', canceled: '已取消' } as const
const statusColor = { queued: 'default', processing: 'processing', succeeded: 'success', failed: 'error', canceled: 'default' } as const

function generationFailureDescription(failureCode: string | null) {
  if (!failureCode) return '模型返回未通过校验'
  if (failureCode.startsWith('invalid_schema:')) return `模型字段未通过校验：${failureCode.slice('invalid_schema:'.length)}`
  if (failureCode === 'invalid_schema') return '模型字段未通过结构校验，请重试'
  if (failureCode === 'invalid_json') return '模型 JSON 输出不完整，请重试'
  return failureCode
}

export default function ContentProductionPage() {
  const { token } = useAuth()
  const { message, notification } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [draftId, setDraftId] = useState<string>()
  const [selectedJobId, setSelectedJobId] = useState<string>()
  const [outlineIds, setOutlineIds] = useState<string[]>([])
  const [candidateIds, setCandidateIds] = useState<string[]>([])
  const [previewCandidateId, setPreviewCandidateId] = useState<string>()
  const [outlineEdits, setOutlineEdits] = useState<AdminSessionOutline[]>([])

  const index = useQuery({ queryKey: queryKeys.content, queryFn: () => adminApi.getContentIndex(token) })
  const drafts = index.data?.drafts.filter((draft) => draft.status === 'draft') ?? []
  const activeDraftId = draftId ?? drafts[0]?.id
  const draft = useQuery({ queryKey: queryKeys.draft(activeDraftId ?? ''), queryFn: () => adminApi.getDraft(token, activeDraftId!), enabled: Boolean(activeDraftId) })
  const readiness = useQuery({ queryKey: queryKeys.contentReadiness(activeDraftId ?? ''), queryFn: () => adminApi.getContentReadiness(token, activeDraftId!), enabled: Boolean(activeDraftId) })
  const jobs = useQuery({
    queryKey: queryKeys.generationJobs(activeDraftId ?? ''), queryFn: () => adminApi.getGenerationJobs(token, activeDraftId!), enabled: Boolean(activeDraftId),
    refetchInterval: (query) => query.state.data?.items.some((job) => job.status === 'queued' || job.status === 'processing') ? 1500 : false,
  })
  const selectedJob = jobs.data?.items.find((job) => job.id === selectedJobId) ?? jobs.data?.items[0]
  const selectedCandidate = selectedJob?.candidates.find((candidate) => candidate.candidateId === previewCandidateId) ?? selectedJob?.candidates[0]
  const insertedCandidateIds = useMemo(() => new Set(selectedJob?.insertedCandidateIds ?? []), [selectedJob?.insertedCandidateIds])
  const generationStep = selectedJob?.operation === 'session_outlines'
    ? 0
    : selectedJob?.insertedCandidateIds.length
      ? 3
      : selectedJob?.status === 'succeeded'
        ? 2
        : 1
  const catalogOptions = useMemo(() => readiness.data?.catalogs.map((catalog) => ({ value: catalog.catalogId, label: `${catalog.title}（${catalog.count}/${catalog.target}）` })) ?? [], [readiness.data])
  const requestedCount = Form.useWatch('count', form) as number | undefined
  useEffect(() => {
    if (!requestedCount) return
    const current = form.getFieldValue('difficulties') as string[] | undefined
    if (current?.length === requestedCount) return
    form.setFieldValue('difficulties', defaultDifficulties.slice(0, requestedCount))
  }, [form, requestedCount])
  useEffect(() => {
    const next = selectedJob?.operation === 'session_outlines' ? selectedJob.outlines : []
    setOutlineEdits((current) => current.length && current[0]?.outlineId === next[0]?.outlineId ? current : structuredClone(next))
  }, [selectedJob?.id, selectedJob?.operation, selectedJob?.status, selectedJob?.outlines])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.generationJobs(activeDraftId ?? '') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.contentReadiness(activeDraftId ?? '') }),
    ])
  }
  const outlinesMutation = useMutation({
    mutationFn: async (values: { catalogId: string; count: number; difficulties: Array<'L1' | 'L2' | 'L3'>; brief: string }) => adminApi.generateSessionOutlines(token, activeDraftId!, values.catalogId, {
      requestId: crypto.randomUUID(), revision: draft.data!.revision, count: values.count,
      difficulties: values.difficulties, brief: values.brief,
    }),
    onSuccess: async (job) => { setSelectedJobId(job.id); setOutlineIds([]); await refresh(); message.success('大纲任务已开始，可离开页面后再回来查看') },
    onError: (cause: ApiError) => notification.error({ message: '无法创建大纲任务', description: cause.message }),
  })
  const sessionsMutation = useMutation({
    mutationFn: () => adminApi.generateTrainingSessions(token, activeDraftId!, {
      requestId: crypto.randomUUID(), revision: draft.data!.revision, outlineJobId: selectedJob!.id, outlineIds,
      outlines: outlineEdits.filter((outline) => outlineIds.includes(outline.outlineId)), reviewVariantCount: 2,
    }),
    onSuccess: async (job) => { setSelectedJobId(job.id); setCandidateIds([]); await refresh(); message.success('完整训练任务已开始') },
    onError: (cause: ApiError) => notification.error({ message: '无法创建完整训练任务', description: cause.message }),
  })
  const insertMutation = useMutation({
    mutationFn: () => adminApi.insertGenerationCandidates(token, selectedJob!.id, draft.data!.revision, candidateIds),
    onSuccess: async (value) => {
      queryClient.setQueryData(queryKeys.draft(value.id), value)
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: queryKeys.content })])
      setCandidateIds([]); message.success('候选已插入草稿，请继续编辑并完成审核')
    },
    onError: (cause: ApiError) => notification.error({ message: '候选插入失败', description: cause.message }),
  })
  const cancelMutation = useMutation({ mutationFn: (jobId: string) => adminApi.cancelGenerationJob(token, jobId), onSuccess: refresh })
  const retryMutation = useMutation({
    mutationFn: async (job: AdminContentGenerationJob) => {
      if (job.operation === 'session_outlines') {
        return adminApi.generateSessionOutlines(token, activeDraftId!, job.catalogId, {
          requestId: crypto.randomUUID(), revision: draft.data!.revision, count: job.requestedCount,
          difficulties: job.parameters.difficulties, brief: job.parameters.brief ?? '重新生成同一批匿名职场训练大纲。',
        })
      }
      const source = jobs.data?.items.find((item) => item.id === job.parameters.outlineJobId)
      if (!source) throw new Error('原大纲任务已不可用，请重新生成大纲')
      const selected = source.outlines.filter((outline) => job.parameters.outlineIds.includes(outline.outlineId))
      return adminApi.generateTrainingSessions(token, activeDraftId!, {
        requestId: crypto.randomUUID(), revision: draft.data!.revision, outlineJobId: source.id,
        outlineIds: selected.map((outline) => outline.outlineId), outlines: selected, reviewVariantCount: 2,
      })
    },
    onSuccess: async (job) => { setSelectedJobId(job.id); await refresh(); message.success('重试任务已创建') },
    onError: (cause: Error) => notification.error({ message: '无法重试任务', description: cause.message }),
  })

  if (index.isLoading) return <PageLoading rows={8} />
  return <section className="content-production-page">
    <PageHeader eyebrow="封测内容产线" title="训练内容生产" description="先确认大纲，再生成完整六卡片训练。AI 只生成候选，不会自动保存、审核或发布。" />
    {!drafts.length && <Alert type="info" showIcon message="请先创建内容草稿" description="内容生产任务必须绑定一个可编辑草稿。" />}
    {drafts.length > 0 && <>
      <Card className="production-summary-card">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={8}><Select className="full-width" value={activeDraftId} options={drafts.map((item) => ({ value: item.id, label: `基于 v${item.baseReleaseVersion} · 修订 ${item.revision}` }))} onChange={(value) => { setDraftId(value); setSelectedJobId(undefined) }} /></Col>
          <Col xs={12} md={4}><Statistic title="当前训练" value={readiness.data?.totalSessions ?? 0} suffix="/ 30" /></Col>
          <Col xs={12} md={4}><Statistic title="待审核" value={readiness.data?.unreviewedSessions.length ?? 0} /></Col>
          <Col xs={24} md={8}><Progress percent={Math.min(100, Math.round(((readiness.data?.totalSessions ?? 0) / 30) * 100))} status={readiness.data?.targetMet ? 'success' : 'active'} /></Col>
        </Row>
        <div className="production-catalog-progress">{readiness.data?.catalogs.map((catalog) => <Tag color={catalog.count >= catalog.target ? 'green' : 'purple'} key={catalog.catalogId}>{catalog.title} {catalog.count}/{catalog.target}</Tag>)}</div>
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="1. 生成训练大纲">
            <Form form={form} layout="vertical" initialValues={{ count: 5, difficulties: [...defaultDifficulties] }} onFinish={(values) => outlinesMutation.mutate(values)}>
              <Form.Item name="catalogId" label="目标章节" rules={[{ required: true }]}><Select options={catalogOptions} /></Form.Item>
              <Form.Item name="count" label="候选数量" rules={[{ required: true }]}><InputNumber min={1} max={5} className="full-width" /></Form.Item>
              <Form.Item label="候选难度"><Form.List name="difficulties">{(fields) => <Space wrap>{fields.slice(0, requestedCount).map((field, index) => <Form.Item key={field.key} name={field.name} noStyle rules={[{ required: true }]}><Select aria-label={`候选 ${index + 1} 难度`} style={{ width: 88 }} options={['L1', 'L2', 'L3'].map((value) => ({ value }))} /></Form.Item>)}</Space>}</Form.List></Form.Item>
              <Form.Item name="brief" label="本批方向与排除项" rules={[{ required: true, min: 10, max: 500 }]}><Input.TextArea rows={6} maxLength={500} showCount placeholder="例如：范围协商、非工作时间响应；避免劳动争议和真实公司信息。" /></Form.Item>
              <Button block type="primary" htmlType="submit" icon={<ExperimentOutlined />} loading={outlinesMutation.isPending} disabled={!draft.data}>生成大纲</Button>
            </Form>
          </Card>
          <Card title="任务记录" className="production-jobs-card">
            <Table size="small" rowKey="id" pagination={false} dataSource={jobs.data?.items ?? []} onRow={(record) => ({ onClick: () => { setSelectedJobId(record.id); setOutlineIds([]); setCandidateIds([]) } })} rowClassName={(record) => record.id === selectedJob?.id ? 'selected-row' : ''} columns={[
              { title: '阶段', dataIndex: 'operation', render: (value) => value === 'session_outlines' ? '大纲' : '完整训练' },
              { title: '状态', dataIndex: 'status', render: (value) => <Tag color={statusColor[value as keyof typeof statusColor]}>{statusLabel[value as keyof typeof statusLabel]}</Tag> },
              { title: '数量', dataIndex: 'requestedCount', width: 56 },
            ]} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="2. 筛选候选" extra={selectedJob && (selectedJob.status === 'queued' || selectedJob.status === 'processing') ? <Button danger size="small" icon={<StopOutlined />} loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate(selectedJob.id)}>取消</Button> : null}>
            {!selectedJob && <Empty description="选择或创建一个生成任务" />}
            {selectedJob && <>
              <Steps size="small" current={generationStep} items={[{ title: '训练大纲' }, { title: '完整训练' }, { title: '插入草稿' }]} />
              <Space className="production-job-meta" wrap><Tag>{selectedJob.catalogId}</Tag><Tag color={statusColor[selectedJob.status]}>{statusLabel[selectedJob.status]}</Tag><span>${selectedJob.estimatedCostUsd.toFixed(4)}</span><span>{selectedJob.latencyMs ? `${selectedJob.latencyMs} ms` : '等待执行'}</span></Space>
              {selectedJob.status === 'failed' && <Alert type="error" showIcon message="生成失败" description={generationFailureDescription(selectedJob.failureCode)} action={<Button size="small" loading={retryMutation.isPending} onClick={() => retryMutation.mutate(selectedJob)}>重试</Button>} />}
              {selectedJob.operation === 'session_outlines' && selectedJob.status === 'succeeded' && <>
                <Checkbox.Group value={outlineIds} onChange={(values) => setOutlineIds(values as string[])} className="production-selector">
                  {outlineEdits.map((outline, index) => <Card size="small" key={outline.outlineId} title={<Checkbox value={outline.outlineId}>{outline.title || '未命名大纲'}</Checkbox>} extra={<Space><Select size="small" value={outline.difficulty} options={['L1', 'L2', 'L3'].map((value) => ({ value }))} onChange={(value) => setOutlineEdits((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, difficulty: value } : item))} /><Select size="small" value={outline.riskLevel} options={[{ value: 'low', label: '低风险' }, { value: 'medium', label: '中风险' }]} onChange={(value) => setOutlineEdits((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, riskLevel: value } : item))} /></Space>}>
                    <Input value={outline.title} maxLength={50} placeholder="训练标题" onChange={(event) => setOutlineEdits((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                    <Input.TextArea value={outline.objective} maxLength={120} rows={2} placeholder="学习目标" onChange={(event) => setOutlineEdits((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, objective: event.target.value } : item))} />
                    <Input.TextArea value={outline.scenarioAngle} maxLength={160} rows={2} placeholder="情境角度" onChange={(event) => setOutlineEdits((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, scenarioAngle: event.target.value } : item))} />
                    <Input value={outline.reviewFocus} maxLength={100} placeholder="复习重点" onChange={(event) => setOutlineEdits((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, reviewFocus: event.target.value } : item))} />
                  </Card>)}
                </Checkbox.Group>
                <Button block type="primary" icon={<PlusOutlined />} disabled={!outlineIds.length || selectedJob.draftRevision !== draft.data?.revision} loading={sessionsMutation.isPending} onClick={() => sessionsMutation.mutate()}>生成选中的完整训练（{outlineIds.length}）</Button>
                {selectedJob.draftRevision !== draft.data?.revision && <Alert type="warning" showIcon message="任务已过期" description="草稿 revision 已变化，请重新生成大纲。" />}
              </>}
              {selectedJob.operation === 'training_sessions' && selectedJob.status === 'succeeded' && <>
                <Checkbox.Group value={candidateIds} onChange={(values) => setCandidateIds(values as string[])} className="production-selector">
                  {selectedJob.candidates.map((candidate) => {
                    const inserted = insertedCandidateIds.has(candidate.candidateId)
                    return <Card size="small" className={`candidate-card${previewCandidateId === candidate.candidateId ? ' selected' : ''}${inserted ? ' inserted' : ''}`} key={candidate.candidateId} title={inserted
                      ? <span className="candidate-inserted-title"><CheckCircleOutlined /><span>{candidate.session.title}</span><Tag color="success">已插入</Tag></span>
                      : <Checkbox value={candidate.candidateId}>{candidate.session.title}</Checkbox>} extra={<Button type="link" onClick={() => setPreviewCandidateId(candidate.candidateId)}>预览</Button>}>
                      <Typography.Paragraph>{candidate.session.objective}</Typography.Paragraph><Space><Tag>{candidate.session.difficulty}</Tag><Tag>{candidate.session.reviewVariants.length} 个变体</Tag></Space>
                    </Card>
                  })}
                </Checkbox.Group>
                {selectedJob.insertedCandidateIds.length > 0
                  ? <div className="production-insert-success"><CheckCircleOutlined /><div><strong>已插入 {selectedJob.insertedCandidateIds.length} 组训练</strong><span>{selectedJob.insertedCandidateIds.length === selectedJob.candidates.length ? '候选已写入草稿，可继续编辑、校验和审核。' : '其余候选因草稿已变化，需要重新生成后插入。'}</span></div><Button type="primary" ghost onClick={() => navigate(`/content/drafts/${selectedJob.draftId}`)}>前往内容管理</Button></div>
                  : <><Button block type="primary" icon={<CheckCircleOutlined />} disabled={!candidateIds.length || selectedJob.draftRevision !== draft.data?.revision} loading={insertMutation.isPending} onClick={() => insertMutation.mutate()}>插入草稿（{candidateIds.length}）</Button>{selectedJob.draftRevision !== draft.data?.revision && <Alert type="warning" showIcon message="候选已过期" description="草稿已经变化，不能再插入本批候选。" />}</>}
              </>}
            </>}
          </Card>
        </Col>
        <Col xs={24} xl={7}><Card title="3. 移动端预览" className="production-preview-card">{selectedCandidate ? <CardPreview session={selectedCandidate.session} /> : <Empty description="选择完整训练候选后预览" />}</Card></Col>
      </Row>
      {readiness.data && <Card title="发布就绪度" className="production-readiness-card">
        <Row gutter={[12, 12]}><Col xs={12} md={6}><Statistic title="阻断项" value={readiness.data.blockingIssues.length} prefix={readiness.data.blockingIssues.length ? <CloseCircleOutlined /> : <CheckCircleOutlined />} /></Col><Col xs={12} md={6}><Statistic title="警告" value={readiness.data.warnings.length} /></Col><Col xs={12} md={6}><Statistic title="缺少两个变体" value={readiness.data.missingVariants.length} /></Col><Col xs={12} md={6}><Statistic title="已变更训练" value={readiness.data.changedSessions.length} /></Col></Row>
      </Card>}
    </>}
  </section>
}
