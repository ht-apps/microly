import { CheckCircleOutlined, ExclamationCircleOutlined, PlusOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TrainingContentBundleSchema } from '@microly/content-schema'
import type { AdminDraftValidation } from '@microly/api-contract'
import { App, Badge, Button, Card, Empty, Form, Input, Layout, Modal, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router'

import { adminApi, ApiError } from '../api'
import { useAuth } from '../auth'
import { CardPreview } from '../components/CardPreview'
import type { EditorIssue, JsonEditorHandle } from '../components/JsonEditor'
import { PageError, PageLoading } from '../components/PageState'
import { PageHeader } from '../components/PageHeader'
import { queryKeys } from '../query-client'

const LazyJsonEditor = lazy(() => import('../components/JsonEditor').then((module) => ({ default: module.JsonEditor })))

type ReasonAction = 'publish' | 'withdraw'

export default function ContentPage() {
  const { token } = useAuth()
  const { draftId } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const queryClient = useQueryClient()
  const { message, modal, notification } = App.useApp()
  const editorRef = useRef<JsonEditorHandle>(null)
  const [editor, setEditor] = useState('')
  const [dirty, setDirty] = useState(false)
  const [validation, setValidation] = useState<(AdminDraftValidation & { revision: number }) | null>(null)
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null)
  const [reasonForm] = Form.useForm<{ reason: string }>()

  const indexQuery = useQuery({ queryKey: queryKeys.content, queryFn: () => adminApi.getContentIndex(token) })
  const draftQuery = useQuery({
    queryKey: queryKeys.draft(draftId ?? ''),
    queryFn: () => adminApi.getDraft(token, draftId as string),
    enabled: Boolean(draftId),
  })
  const draft = draftQuery.data

  useEffect(() => {
    if (!draft) return
    setEditor(JSON.stringify(draft.bundle, null, 2))
    setDirty(false)
    setValidation(null)
  }, [draft])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '离开后，本次编辑内容不会保留。',
      okText: '放弃并离开', cancelText: '继续编辑', okButtonProps: { danger: true },
      onOk: blocker.proceed,
      onCancel: blocker.reset,
    })
  }, [blocker, modal])

  const parsed = useMemo(() => {
    try { return TrainingContentBundleSchema.safeParse(JSON.parse(editor)) } catch { return null }
  }, [editor])
  const sessions = parsed?.success ? Object.values(parsed.data.sessions) : []
  const selectedSessionId = search.get('session') ?? sessions[0]?.sessionId ?? ''
  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId) ?? sessions[0] ?? null

  const refreshContent = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.content })
  }
  const createMutation = useMutation({
    mutationFn: (version?: number) => version
      ? adminApi.createRollbackDraft(token, version)
      : adminApi.createDraft(token),
    onSuccess: async (value, version) => {
      queryClient.setQueryData(queryKeys.draft(value.id), value)
      await refreshContent()
      navigate(`/content/drafts/${value.id}`)
      message.success(version ? `已基于 v${version} 创建回滚草稿` : '草稿已创建')
    },
    onError: (cause) => notification.error({ message: '草稿创建失败', description: cause.message }),
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('请先选择草稿')
      let bundle: unknown
      try { bundle = JSON.parse(editor) } catch { throw new Error('JSON 语法错误，请先修正') }
      return adminApi.saveDraft(token, draft.id, draft.revision, bundle)
    },
    onSuccess: async (value) => {
      queryClient.setQueryData(queryKeys.draft(value.id), value)
      setEditor(JSON.stringify(value.bundle, null, 2))
      setDirty(false)
      setValidation(null)
      await refreshContent()
      message.success('草稿已保存')
    },
    onError: (cause) => notification.error({
      message: cause instanceof ApiError && cause.code === 'draft_conflict' ? '草稿版本冲突' : '保存失败',
      description: cause.message,
    }),
  })
  const validateMutation = useMutation({
    mutationFn: () => adminApi.validateDraft(token, draftId as string),
    onSuccess: (value) => {
      setValidation({ ...value, revision: draft?.revision ?? 0 })
      if (value.valid) message.success('校验通过，可以发布')
      else message.warning('校验未通过，请按路径修正')
    },
    onError: (cause) => notification.error({ message: '校验失败', description: cause.message }),
  })
  const publishMutation = useMutation({
    mutationFn: (reason: string) => adminApi.publishDraft(token, draftId as string, draft?.revision ?? 0, reason),
    onSuccess: async (value) => {
      setReasonAction(null)
      reasonForm.resetFields()
      await refreshContent()
      navigate('/content', { replace: true })
      message.success(`v${value.releaseVersion} 已发布`)
    },
    onError: (cause) => notification.error({ message: '发布失败', description: cause.message }),
  })
  const withdrawMutation = useMutation({
    mutationFn: (reason: string) => adminApi.withdrawSession(token, selectedSessionId, reason),
    onSuccess: async (value) => {
      setReasonAction(null)
      reasonForm.resetFields()
      await refreshContent()
      message.success(`训练已下架并发布为 v${value.releaseVersion}`)
    },
    onError: (cause) => notification.error({ message: '下架失败', description: cause.message }),
  })

  const requestRollback = (version: number) => modal.confirm({
    title: `基于 v${version} 创建回滚草稿？`,
    icon: <ExclamationCircleOutlined />,
    content: '该操作不会直接修改当前发布内容，确认草稿后仍需重新校验和发布。',
    okText: '创建草稿',
    onOk: () => createMutation.mutateAsync(version),
  })
  const submitReason = async () => {
    const { reason } = await reasonForm.validateFields()
    if (reasonAction === 'publish') publishMutation.mutate(reason.trim())
    if (reasonAction === 'withdraw') withdrawMutation.mutate(reason.trim())
  }
  const issues = (validation?.issues ?? []) as EditorIssue[]
  const publishReady = Boolean(draft && validation?.valid && validation.revision === draft.revision && !dirty)
  const busy = saveMutation.isPending || validateMutation.isPending || publishMutation.isPending || withdrawMutation.isPending

  if (indexQuery.isError) return <PageError onRetry={() => void indexQuery.refetch()} />
  return <section>
    <PageHeader eyebrow="内容运营" title="版本与草稿" description="发布快照不可修改；回滚和下架都会生成更高版本。" extra={<Button type="primary" icon={<PlusOutlined />} loading={createMutation.isPending} disabled={!indexQuery.data?.currentVersion} onClick={() => createMutation.mutate(undefined)}>新建草稿</Button>} />
    {indexQuery.isLoading ? <PageLoading rows={10} /> : <Layout className="content-workbench">
      <Layout.Sider width={270} theme="light" className="content-sidebar">
        <Typography.Title level={5}>草稿</Typography.Title>
        <div className="draft-list">
          {indexQuery.data?.drafts.filter((item) => item.status === 'draft').map((item) => <button type="button" className={draftId === item.id ? 'draft-item active' : 'draft-item'} key={item.id} onClick={() => navigate(`/content/drafts/${item.id}`)}>
            <span><strong>基于 v{item.baseReleaseVersion}</strong><Badge status={draftId === item.id ? 'processing' : 'default'} /></span>
            <small>修订 {item.revision} · {new Date(item.updatedAt).toLocaleString()}</small>
          </button>)}
          {!indexQuery.data?.drafts.some((item) => item.status === 'draft') && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理草稿" />}
        </div>
        <Typography.Title level={5} className="release-heading">发布历史</Typography.Title>
        <div className="release-list">{indexQuery.data?.releases.map((release, index) => <div className="release-item" key={release.releaseVersion}>
          <div><span><strong>v{release.releaseVersion}</strong>{index === 0 && <Tag color="purple">当前</Tag>}</span><small>{release.sessionCount} 组 · {new Date(release.publishedAt).toLocaleString()}</small></div>
          <Button type="link" size="small" onClick={() => requestRollback(release.releaseVersion)}>回滚草稿</Button>
        </div>)}</div>
      </Layout.Sider>
      <Layout.Content className="content-editor-panel">
        {!draftId && <Empty className="workbench-empty" description="选择现有草稿，或从当前版本新建草稿" />}
        {draftId && draftQuery.isLoading && <PageLoading rows={10} />}
        {draftId && draftQuery.isError && <PageError onRetry={() => void draftQuery.refetch()} />}
        {draft && <>
          <div className="editor-toolbar">
            <Space><Typography.Text strong>草稿 · 修订 {draft.revision}</Typography.Text>{dirty ? <Tag color="gold">未保存</Tag> : <Tag color="green">已保存</Tag>}</Space>
            <Space wrap>
              <Button onClick={() => editorRef.current?.format()}>格式化</Button>
              <Button icon={<SaveOutlined />} loading={saveMutation.isPending} disabled={!dirty || busy} onClick={() => saveMutation.mutate()}>保存</Button>
              <Button loading={validateMutation.isPending} disabled={dirty || busy} onClick={() => validateMutation.mutate()}>校验</Button>
              <Tooltip title={publishReady ? '' : '保存并通过当前修订校验后才能发布'}><span><Button type="primary" icon={<CheckCircleOutlined />} disabled={!publishReady || busy} onClick={() => setReasonAction('publish')}>发布</Button></span></Tooltip>
            </Space>
          </div>
          <Suspense fallback={<Spin className="editor-loading" description="正在加载 Monaco Editor…" />}>
            <LazyJsonEditor ref={editorRef} value={editor} issues={issues} onChange={(value) => { setEditor(value); setDirty(true); setValidation(null) }} />
          </Suspense>
          <Card title="校验结果" variant="borderless" className="validation-panel">
            {!validation && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={dirty ? '请先保存草稿，再运行校验' : '运行校验后将在这里显示问题'} />}
            {validation && !issues.length && <div className="validation-success"><CheckCircleOutlined /> 内容校验通过</div>}
            {issues.map((issue, index) => <button className={`validation-issue ${issue.severity}`} key={`${issue.path}-${index}`} onClick={() => editorRef.current?.revealPath(issue.path)}><code>{issue.path || '$'}</code><span>{issue.message}</span></button>)}
          </Card>
        </>}
      </Layout.Content>
      <Layout.Sider width={370} theme="light" className="preview-sidebar">
        <div className="preview-toolbar">
          <span className="preview-toolbar__label">训练预览</span>
          <div className="preview-toolbar__controls">
            <Select className="preview-session-select" value={selectedSession?.sessionId} placeholder="选择训练" options={sessions.map((session) => ({ value: session.sessionId, label: session.title }))} onChange={(session) => setSearch({ session })} />
            <Button className="preview-withdraw-button" danger icon={<StopOutlined />} disabled={!selectedSession || busy} onClick={() => setReasonAction('withdraw')}>下架</Button>
          </div>
        </div>
        <CardPreview session={selectedSession} />
      </Layout.Sider>
    </Layout>}
    <Modal
      open={reasonAction !== null}
      title={reasonAction === 'publish' ? '确认发布当前草稿' : `确认下架 ${selectedSession?.title ?? '当前训练'}`}
      okText={reasonAction === 'publish' ? '发布新版本' : '确认下架'}
      okButtonProps={{ danger: reasonAction === 'withdraw', loading: publishMutation.isPending || withdrawMutation.isPending }}
      onOk={() => void submitReason()}
      onCancel={() => { setReasonAction(null); reasonForm.resetFields() }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{reasonAction === 'publish' ? '发布后将生成不可修改的新版本。' : '下架会立即生成移除该训练的新版本，历史学习记录仍会保留。'}</Typography.Paragraph>
      <Form form={reasonForm} layout="vertical" requiredMark={false} preserve={false}>
        <Form.Item name="reason" label="操作原因" rules={[{ required: true, message: '请填写操作原因' }, { min: 3, max: 300, message: '请输入 3–300 个字符' }]}>
          <Input.TextArea rows={4} maxLength={300} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  </section>
}
