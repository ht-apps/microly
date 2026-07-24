import { CheckCircleOutlined, DeleteOutlined, ExclamationCircleOutlined, PlusOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TrainingContentBundleSchema, type ReviewVariant, type TrainingContentBundle } from '@microly/content-schema'
import type { AdminDraftValidation } from '@microly/api-contract'
import { Alert, App, Badge, Button, Card, Checkbox, Empty, Form, Input, Layout, Modal, Segmented, Space, Spin, Tag, Tooltip, TreeSelect, Typography } from 'antd'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router'

import { adminApi, ApiError } from '../api'
import { useAuth } from '../auth'
import { CardPreview } from '../components/CardPreview'
import { ContentFormEditor } from '../components/ContentFormEditor'
import type { EditorIssue, JsonEditorHandle } from '../components/JsonEditor'
import { ReviewChecklist } from '../components/ReviewChecklist'
import { parseEditableBundle, semanticJson, type EditableBundle } from '../features/content/content-workspace'
import { PageError, PageLoading } from '../components/PageState'
import { PageHeader } from '../components/PageHeader'
import { queryKeys } from '../query-client'

const LazyJsonEditor = lazy(() => import('../components/JsonEditor').then((module) => ({ default: module.JsonEditor })))

type ReasonAction = 'publish' | 'withdraw'

const reviewChecks = [
  ['objectiveAligned', '教学目标明确且一致'],
  ['optionQuality', '三个选项质量与评分合理'],
  ['feedbackBalanced', '反馈平衡且不做人格评价'],
  ['principleConsistent', '原则与训练目标一致'],
  ['practiceRubric', '主动表达维度可判定'],
  ['safetyAndPrivacy', '安全与隐私检查通过'],
  ['mobilePreview', '移动端预览可读'],
] as const

type ReviewFormValues = {
  checks: string[]
  operatorLabel: string
  reviewerLabel?: string
  note?: string
}

export default function ContentPage() {
  const { token } = useAuth()
  const { draftId } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const queryClient = useQueryClient()
  const { message, modal, notification } = App.useApp()
  const editorRef = useRef<JsonEditorHandle>(null)
  const [editor, setEditor] = useState('')
  const [savedSemantic, setSavedSemantic] = useState('')
  const [editorMode, setEditorMode] = useState<'form' | 'json'>('form')
  const [dirty, setDirty] = useState(false)
  const [validation, setValidation] = useState<(AdminDraftValidation & { revision: number }) | null>(null)
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null)
  const [variantCandidates, setVariantCandidates] = useState<ReviewVariant[]>([])
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([])
  const [releaseView, setReleaseView] = useState<'summary' | 'form' | 'json'>('summary')
  const [reviewSessionId, setReviewSessionId] = useState<string | null>(null)
  const [reasonForm] = Form.useForm<{ reason: string }>()
  const [reviewForm] = Form.useForm<ReviewFormValues>()

  const indexQuery = useQuery({ queryKey: queryKeys.content, queryFn: () => adminApi.getContentIndex(token) })
  const draftQuery = useQuery({
    queryKey: queryKeys.draft(draftId ?? ''),
    queryFn: () => adminApi.getDraft(token, draftId as string),
    enabled: Boolean(draftId),
  })
  const draft = draftQuery.data
  const reviewsQuery = useQuery({
    queryKey: queryKeys.contentReviews(draftId ?? ''),
    queryFn: () => adminApi.getContentReviews(token, draftId as string),
    enabled: Boolean(draftId && draft),
  })
  const readinessQuery = useQuery({
    queryKey: queryKeys.contentReadiness(draftId ?? ''),
    queryFn: () => adminApi.getContentReadiness(token, draftId as string),
    enabled: Boolean(draftId && draft),
  })
  const requestedReleaseVersion = Number(search.get('release'))
  const releaseVersion = Number.isInteger(requestedReleaseVersion) && requestedReleaseVersion > 0 ? requestedReleaseVersion : null
  const releaseQuery = useQuery({
    queryKey: queryKeys.release(releaseVersion ?? 0),
    queryFn: () => adminApi.getRelease(token, releaseVersion as number),
    enabled: !draftId && releaseVersion !== null,
  })
  useEffect(() => setReleaseView('summary'), [releaseVersion])

  useEffect(() => {
    if (!draft) return
    setEditor(JSON.stringify(draft.bundle, null, 2))
    setSavedSemantic(semanticJson(draft.bundle))
    setDirty(false)
    setValidation(null)
    setEditorMode('form')
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

  const editable = useMemo(() => parseEditableBundle(editor), [editor])
  const liveIssues = useMemo<EditorIssue[]>(() => {
    if (!editable.bundle) return []
    const result = TrainingContentBundleSchema.safeParse(editable.bundle)
    return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message, severity: 'error' }))
  }, [editable.bundle])
  const previewBundle = draftId
    ? (editable.bundle as TrainingContentBundle | null)
    : releaseQuery.data?.bundle ?? null
  const sessions = previewBundle ? Object.values(previewBundle.sessions) : []
  const previewTreeData = useMemo(() => {
    if (!previewBundle) return []
    const included = new Set<string>()
    const catalogs = previewBundle.library.catalogIds.flatMap((catalogId) => {
      const catalog = previewBundle.catalogs[catalogId]
      if (!catalog) return []
      const children = catalog.sessionIds.flatMap((sessionId) => {
        const session = previewBundle.sessions[sessionId]
        if (!session || included.has(sessionId)) return []
        included.add(sessionId)
        return [{ title: session.title, value: `session:${sessionId}` }]
      })
      return [{ title: catalog.title, value: `catalog:${catalogId}`, selectable: false, children }]
    })
    const ungrouped = Object.values(previewBundle.sessions)
      .filter((session) => !included.has(session.sessionId))
      .map((session) => ({ title: session.title, value: `session:${session.sessionId}` }))
    return ungrouped.length
      ? [...catalogs, { title: '未归类训练', value: 'catalog:ungrouped', selectable: false, children: ungrouped }]
      : catalogs
  }, [previewBundle])
  const selectedSessionId = search.get('session') ?? sessions[0]?.sessionId ?? ''
  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId) ?? sessions[0] ?? null
  const selectSession = (session: string) => {
    const next = new URLSearchParams(search)
    next.set('session', session)
    setSearch(next)
  }
  const requestWithdraw = (sessionId: string) => {
    selectSession(sessionId)
    setReasonAction('withdraw')
  }
  const selectFormNode = (node: string) => {
    const next = new URLSearchParams(search)
    next.set('node', node)
    const [, sessionId] = node.split(':')
    if ((node.startsWith('session:') || node.startsWith('variant:')) && sessionId) next.set('session', sessionId)
    setSearch(next)
  }
  const updateEditorText = (value: string) => {
    setEditor(value)
    const next = parseEditableBundle(value)
    setDirty(!next.bundle || semanticJson(next.bundle) !== savedSemantic)
    setValidation(null)
  }
  const updateFromForm = (bundle: EditableBundle) => updateEditorText(JSON.stringify(bundle, null, 2))
  const switchEditorMode = (mode: 'form' | 'json') => {
    if (mode === 'form' && !editable.bundle) {
      notification.warning({ message: '无法切换到可视化表单', description: editable.error })
      if (editable.errorPath) editorRef.current?.revealPath(editable.errorPath)
      return
    }
    setEditorMode(mode)
  }
  const revealIssue = (path: string) => {
    if (editorMode === 'json') {
      editorRef.current?.revealPath(path)
      return
    }
    const parts = path.split('.')
    if (parts[0] === 'catalogs' && parts[1]) {
      selectFormNode(`catalog:${parts[1]}`)
      return
    }
    if (parts[0] === 'sessions' && parts[1]) {
      const variantIndex = parts[2] === 'reviewVariants' ? Number(parts[3]) : -1
      const variantId = editable.bundle?.sessions[parts[1]]?.reviewVariants?.[variantIndex]?.variantId
      selectFormNode(variantId ? `variant:${parts[1]}:${variantId}` : `session:${parts[1]}`)
      return
    }
    selectFormNode('library')
  }

  const refreshContent = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.content })
  }
  const refreshDraftReviewState = async () => {
    if (!draftId) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.contentReviews(draftId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.contentReadiness(draftId) }),
    ])
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
      setSavedSemantic(semanticJson(value.bundle))
      setDirty(false)
      setValidation(null)
      await Promise.all([refreshContent(), refreshDraftReviewState()])
      message.success('草稿已保存')
    },
    onError: (cause) => notification.error({
      message: cause instanceof ApiError && cause.code === 'draft_conflict' ? '草稿版本冲突' : '保存失败',
      description: cause.message,
    }),
  })
  const deleteDraftMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('请先选择草稿')
      return adminApi.deleteDraft(token, draft.id, draft.revision)
    },
    onSuccess: async (value) => {
      setDirty(false)
      queryClient.removeQueries({ queryKey: queryKeys.draft(value.id) })
      await refreshContent()
      navigate('/content', { replace: true })
      message.success('草稿已删除')
    },
    onError: (cause) => notification.error({ message: '删除草稿失败', description: cause.message }),
  })
  const restoreDraftMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('请先选择草稿')
      return adminApi.restoreDraft(token, draft.id, draft.revision)
    },
    onSuccess: async (value) => {
      queryClient.setQueryData(queryKeys.draft(value.id), value)
      setEditor(JSON.stringify(value.bundle, null, 2))
      setSavedSemantic(semanticJson(value.bundle))
      setDirty(false)
      setValidation(null)
      await Promise.all([refreshContent(), refreshDraftReviewState()])
      message.success(`草稿已恢复到 v${value.baseReleaseVersion}`)
    },
    onError: (cause) => notification.error({ message: '恢复草稿失败', description: cause.message }),
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
    onError: async (cause) => {
      if (cause instanceof ApiError && cause.code === 'draft_not_editable') {
        setReasonAction(null)
        reasonForm.resetFields()
        await refreshContent()
        navigate('/content', { replace: true })
        message.warning('草稿已经发布，已刷新发布历史')
        return
      }
      notification.error({ message: '发布失败', description: cause.message })
    },
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
  const generateVariantsMutation = useMutation({
    mutationFn: (sessionId: string) => adminApi.generateReviewVariants(token, draft?.id ?? '', sessionId, draft?.revision ?? 0),
    onSuccess: (value) => {
      setVariantCandidates(value.candidates)
      setSelectedVariantIds(value.candidates.map((item) => item.variantId))
      if (value.warnings.length) message.warning(value.warnings[0])
    },
    onError: (cause) => notification.error({ message: '复习变体生成失败', description: cause.message }),
  })
  const reviewMutation = useMutation({
    mutationFn: async (values: ReviewFormValues) => {
      if (!draft || !reviewSessionId || !editable.bundle) throw new Error('训练不存在或草稿尚未加载')
      const session = editable.bundle.sessions[reviewSessionId]
      if (!session) throw new Error('训练不存在')
      if (dirty) throw new Error('请先保存当前修改，再提交审核')
      if (values.checks.length !== reviewChecks.length) throw new Error('请完成全部七项检查')
      const readiness = readinessQuery.data?.sessionDigests[reviewSessionId]
        ? readinessQuery.data
        : (await readinessQuery.refetch()).data
      const contentDigest = readiness?.sessionDigests[reviewSessionId]
      if (!contentDigest) throw new Error('审核摘要尚未加载，请稍后重试')
      const checklist = Object.fromEntries(reviewChecks.map(([key]) => [key, true])) as Record<string, true>
      return adminApi.reviewSession(token, draft.id, reviewSessionId, {
        revision: draft.revision,
        contentDigest,
        checklist,
        operatorLabel: values.operatorLabel.trim(),
        reviewerLabel: values.reviewerLabel?.trim() || null,
        note: values.note?.trim() || null,
      })
    },
    onSuccess: async () => {
      setReviewSessionId(null)
      reviewForm.resetFields()
      await refreshDraftReviewState()
      message.success('训练审核已记录')
    },
    onError: (cause) => notification.error({ message: '审核提交失败', description: cause.message }),
  })

  const insertVariants = () => {
    if (!selectedSessionId || !selectedVariantIds.length) return
    try {
      const bundle = JSON.parse(editor) as { sessions?: Record<string, { reviewVariants?: ReviewVariant[] }> }
      const target = bundle.sessions?.[selectedSessionId]
      if (!target) throw new Error('当前 JSON 中没有所选训练')
      const selected = variantCandidates.filter((item) => selectedVariantIds.includes(item.variantId))
      const existing = target.reviewVariants ?? []
      target.reviewVariants = [...existing.filter((item) => !selected.some((candidate) => candidate.variantId === item.variantId)), ...selected]
      setEditor(JSON.stringify(bundle, null, 2))
      setDirty(semanticJson(bundle) !== savedSemantic)
      setValidation(null)
      setVariantCandidates([])
      message.success(`已插入 ${selected.length} 个候选，请保存并校验`)
    } catch (cause) {
      notification.error({ message: '无法插入候选', description: cause instanceof Error ? cause.message : '请先修正 JSON' })
    }
  }

  const requestRollback = (version: number) => modal.confirm({
    title: `基于 v${version} 创建回滚草稿？`,
    icon: <ExclamationCircleOutlined />,
    content: '该操作不会直接修改当前发布内容，确认草稿后仍需重新校验和发布。',
    okText: '创建草稿',
    onOk: () => createMutation.mutateAsync(version),
  })
  const requestDeleteDraft = () => modal.confirm({
    title: '删除当前草稿？',
    icon: <ExclamationCircleOutlined />,
    content: '草稿将被永久删除且无法恢复，已发布版本不会受到影响。',
    okText: '删除草稿',
    okButtonProps: { danger: true },
    onOk: () => deleteDraftMutation.mutateAsync(),
  })
  const requestRestoreDraft = () => modal.confirm({
    title: `恢复到基础版本 v${draft?.baseReleaseVersion ?? '—'}？`,
    icon: <ExclamationCircleOutlined />,
    content: '当前草稿中的所有修改（包括未保存修改）都会被基础发布快照覆盖，此操作不可撤销。',
    okText: '恢复基础版本',
    onOk: () => restoreDraftMutation.mutateAsync(),
  })
  const submitReason = async () => {
    const { reason } = await reasonForm.validateFields()
    if (reasonAction === 'publish') publishMutation.mutate(reason.trim())
    if (reasonAction === 'withdraw') withdrawMutation.mutate(reason.trim())
  }
  const issues = (validation?.issues ?? []) as EditorIssue[]
  const publishReady = Boolean(draft && validation?.valid && validation.revision === draft.revision && !dirty
    && readinessQuery.data && readinessQuery.data.unreviewedSessions.length === 0 && readinessQuery.data.blockingIssues.length === 0)
  const busy = saveMutation.isPending || deleteDraftMutation.isPending || restoreDraftMutation.isPending
    || validateMutation.isPending || publishMutation.isPending || withdrawMutation.isPending

  if (indexQuery.isError) return <PageError onRetry={() => void indexQuery.refetch()} />
  return <section className={!draftId && releaseVersion ? 'content-page release-page' : undefined}>
    <PageHeader eyebrow="内容运营" title="版本与草稿" description="发布快照不可修改；回滚和下架都会生成更高版本。" extra={<Space><Button onClick={() => navigate('/content/production')}>内容生产</Button><Button type="primary" icon={<PlusOutlined />} loading={createMutation.isPending} disabled={!indexQuery.data?.currentVersion} onClick={() => createMutation.mutate(undefined)}>新建草稿</Button></Space>} />
    {indexQuery.isLoading ? <PageLoading rows={10} /> : <Layout className={!draftId && releaseVersion ? 'content-workbench release-workbench' : 'content-workbench'}>
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
        <div className="release-list">{indexQuery.data?.releases.map((release, index) => <div className={releaseVersion === release.releaseVersion && !draftId ? 'release-item active' : 'release-item'} key={release.releaseVersion}>
          <button type="button" className="release-preview-trigger" aria-label={`预览发布版本 v${release.releaseVersion}`} onClick={() => navigate(`/content?release=${release.releaseVersion}`)}>
            <span><strong>v{release.releaseVersion}</strong>{index === 0 && <Tag color="purple">当前</Tag>}</span>
            <small>{release.sessionCount} 组 · {new Date(release.publishedAt).toLocaleString()}</small>
          </button>
          <Button type="link" size="small" onClick={() => requestRollback(release.releaseVersion)}>回滚草稿</Button>
        </div>)}</div>
      </Layout.Sider>
      <Layout.Content className={!draftId && releaseVersion ? 'content-editor-panel release-mode' : 'content-editor-panel'}>
        {!draftId && !releaseVersion && <Empty className="workbench-empty" description="选择草稿编辑，或选择发布历史预览" />}
        {!draftId && releaseVersion && releaseQuery.isLoading && <PageLoading rows={10} />}
        {!draftId && releaseVersion && releaseQuery.isError && <PageError onRetry={() => void releaseQuery.refetch()} />}
        {!draftId && releaseQuery.data && <>
          <div className="release-readonly-toolbar content-mode-toolbar">
            <Space className="content-toolbar-heading" size="middle"><Typography.Text strong>v{releaseQuery.data.releaseVersion}</Typography.Text><Tag color="default">只读</Tag><Segmented className="content-view-tabs" value={releaseView} options={[{ label: '发布信息', value: 'summary' }, { label: '表单', value: 'form' }, { label: 'JSON', value: 'json' }]} onChange={(value) => setReleaseView(value as 'summary' | 'form' | 'json')} /></Space>
            <span className="content-toolbar-spacer" aria-hidden="true" />
          </div>
          {releaseView === 'summary' ? <div className="release-preview-summary">
            <Tag color={releaseQuery.data.releaseVersion === indexQuery.data?.currentVersion ? 'purple' : 'default'}>只读快照</Tag>
            <Typography.Title level={3}>发布版本 v{releaseQuery.data.releaseVersion}</Typography.Title>
            <Typography.Paragraph type="secondary">
              {releaseQuery.data.sessionCount} 组训练 · {new Date(releaseQuery.data.publishedAt).toLocaleString()}
            </Typography.Paragraph>
            <Card size="small" title="发布信息">
              <Typography.Paragraph><Typography.Text type="secondary">发布原因：</Typography.Text>{releaseQuery.data.releaseReason ?? '未记录'}</Typography.Paragraph>
              <Typography.Paragraph><Typography.Text type="secondary">来源版本：</Typography.Text>{releaseQuery.data.createdFromVersion ? `v${releaseQuery.data.createdFromVersion}` : '初始版本'}</Typography.Paragraph>
              <Typography.Paragraph copyable={{ text: releaseQuery.data.checksum }} ellipsis><Typography.Text type="secondary">Checksum：</Typography.Text>{releaseQuery.data.checksum}</Typography.Paragraph>
            </Card>
            <Typography.Paragraph type="secondary" className="release-preview-tip">右侧可切换训练，查看该版本发布时的完整卡片内容。历史快照不可修改。</Typography.Paragraph>
          </div> : releaseView === 'form' ? <ContentFormEditor
            bundle={releaseQuery.data.bundle as EditableBundle}
            issues={[]}
            selectedKey={search.get('node') ?? 'library'}
            onSelect={selectFormNode}
            onChange={() => undefined}
            readOnly
            onWithdrawSession={releaseQuery.data.releaseVersion === indexQuery.data?.currentVersion ? requestWithdraw : undefined}
            withdrawDisabled={busy}
          /> : <div className="release-json-view">
            <Suspense fallback={<div className="editor-loading"><Spin description="正在加载 Monaco Editor…" /></div>}>
              <LazyJsonEditor value={JSON.stringify(releaseQuery.data.bundle, null, 2)} issues={[]} readOnly height="100%" onChange={() => undefined} />
            </Suspense>
          </div>}
        </>}
        {draftId && draftQuery.isLoading && <PageLoading rows={10} />}
        {draftId && draftQuery.isError && <PageError onRetry={() => void draftQuery.refetch()} />}
        {draft && <>
          <div className="editor-toolbar content-mode-toolbar">
            <Space className="content-toolbar-heading" size="middle"><Typography.Text strong>草稿 · 修订 {draft.revision}</Typography.Text>{dirty ? <Tag color="gold">未保存</Tag> : <Tag color="green">已保存</Tag>}<Segmented className="content-view-tabs" value={editorMode} options={[{ label: '可视化表单', value: 'form' }, { label: 'JSON', value: 'json' }]} onChange={(value) => switchEditorMode(value as 'form' | 'json')} /></Space>
            <Space className="content-toolbar-actions" wrap>
              {editorMode === 'json' && <Button onClick={() => editorRef.current?.format()}>格式化</Button>}
              <Button icon={<UndoOutlined />} loading={restoreDraftMutation.isPending} disabled={!draft.baseReleaseVersion || busy} onClick={requestRestoreDraft}>恢复到 v{draft.baseReleaseVersion}</Button>
              <Button danger icon={<DeleteOutlined />} loading={deleteDraftMutation.isPending} disabled={busy} onClick={requestDeleteDraft}>删除</Button>
              <Button icon={<SaveOutlined />} loading={saveMutation.isPending} disabled={!dirty || busy} onClick={() => saveMutation.mutate()}>保存</Button>
              <Button loading={validateMutation.isPending} disabled={dirty || busy} onClick={() => validateMutation.mutate()}>校验</Button>
              <Tooltip title={publishReady ? '' : '保存、校验并完成所有变更训练的审核后才能发布'}><span><Button type="primary" icon={<CheckCircleOutlined />} disabled={!publishReady || busy} onClick={() => setReasonAction('publish')}>发布</Button></span></Tooltip>
            </Space>
          </div>
          {editorMode === 'form' && editable.bundle ? <ContentFormEditor
            bundle={editable.bundle}
            issues={liveIssues}
            selectedKey={search.get('node') ?? 'library'}
            onSelect={selectFormNode}
            onChange={updateFromForm}
            onGenerateVariants={(sessionId) => generateVariantsMutation.mutate(sessionId)}
            generateVariantsPending={generateVariantsMutation.isPending}
            generateVariantsDisabled={dirty || busy}
            reviewedSessionIds={(reviewsQuery.data?.items ?? []).filter((item) => item.current).map((item) => item.sessionId)}
            unreviewedSessionIds={readinessQuery.data?.unreviewedSessions ?? []}
            reviewableSessionIds={readinessQuery.data?.changedSessions ?? []}
            onReviewSession={async (sessionId) => {
              if (dirty) {
                message.warning('请先保存当前修改，再审核训练')
                return
              }
              const readiness = readinessQuery.data?.sessionDigests[sessionId]
                ? readinessQuery.data
                : (await readinessQuery.refetch()).data
              if (!readiness?.sessionDigests[sessionId]) {
                message.info('该训练与基础版本一致，无需审核')
                return
              }
              const existing = reviewsQuery.data?.items.find((item) => item.sessionId === sessionId && item.current)
              setReviewSessionId(sessionId)
              reviewForm.setFieldsValue({
                checks: existing ? reviewChecks.map(([key]) => key) : [],
                operatorLabel: existing?.operatorLabel ?? '',
                reviewerLabel: existing?.reviewerLabel ?? undefined,
                note: existing?.note ?? undefined,
              })
            }}
          /> : <Suspense fallback={<div className="editor-loading"><Spin description="正在加载 Monaco Editor…" /></div>}>
            <LazyJsonEditor ref={editorRef} value={editor} issues={issues} onChange={updateEditorText} />
          </Suspense>}
          <Card title="校验结果" variant="borderless" className="validation-panel">
            {!validation && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={dirty ? '请先保存草稿，再运行校验' : '运行校验后将在这里显示问题'} />}
            {validation && !issues.length && <div className="validation-success"><CheckCircleOutlined /> 内容校验通过</div>}
            {issues.map((issue, index) => <button className={`validation-issue ${issue.severity}`} key={`${issue.path}-${index}`} onClick={() => revealIssue(issue.path)}><code>{issue.path || '$'}</code><span>{issue.message}</span></button>)}
          </Card>
        </>}
      </Layout.Content>
      <Layout.Sider width={370} theme="light" className="preview-sidebar">
        <div className="preview-toolbar">
          <span className="preview-toolbar__label">{releaseQuery.data ? `历史版本 v${releaseQuery.data.releaseVersion} · 只读预览` : '训练预览'}</span>
          <div className="preview-toolbar__controls">
            <TreeSelect
              className="preview-session-select"
              value={selectedSession ? `session:${selectedSession.sessionId}` : undefined}
              placeholder="选择训练"
              treeData={previewTreeData}
              treeDefaultExpandAll
              treeLine={{ showLeafIcon: false }}
              showSearch
              treeNodeFilterProp="title"
              popupMatchSelectWidth={320}
              onChange={(value: string) => selectSession(value.replace(/^session:/, ''))}
            />
          </div>
        </div>
        {draftId && !editable.bundle
          ? <Alert className="preview-paused" type="warning" showIcon message="预览已暂停" description={editable.error ?? '请先修正 JSON 内容。'} />
          : <CardPreview session={selectedSession} />}
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
      {reasonAction === 'publish' && readinessQuery.data && <Alert
        className="publish-readiness-summary"
        type={readinessQuery.data.blockingIssues.length || readinessQuery.data.unreviewedSessions.length ? 'warning' : 'success'}
        showIcon
        message={`${readinessQuery.data.totalSessions} / ${readinessQuery.data.targetSessions} 组训练`}
        description={`待审核 ${readinessQuery.data.unreviewedSessions.length} 组 · 缺少复习变体 ${readinessQuery.data.missingVariants.length} 组 · 阻断项 ${readinessQuery.data.blockingIssues.length} 个`}
      />}
      <Form form={reasonForm} layout="vertical" requiredMark={false} preserve={false}>
        <Form.Item name="reason" label="操作原因" rules={[{ required: true, message: '请填写操作原因' }, { min: 3, max: 300, message: '请输入 3–300 个字符' }]}>
          <Input.TextArea rows={4} maxLength={300} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
    <Modal
      open={Boolean(reviewSessionId)}
      title={`审核训练：${reviewSessionId ? editable.bundle?.sessions[reviewSessionId]?.title ?? reviewSessionId : ''}`}
      okText="确认审核"
      okButtonProps={{ loading: reviewMutation.isPending }}
      onOk={() => reviewForm.validateFields().then((values) => reviewMutation.mutate(values))}
      onCancel={() => { setReviewSessionId(null); reviewForm.resetFields() }}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">审核只对当前训练内容摘要有效；继续编辑后会自动失效。</Typography.Paragraph>
      <Form form={reviewForm} layout="vertical" requiredMark={false} preserve={false}>
        <Form.Item name="checks" label="七项检查" rules={[{ validator: (_, value: string[] | undefined) => value?.length === reviewChecks.length ? Promise.resolve() : Promise.reject(new Error('请完成全部七项检查')) }]}>
          <ReviewChecklist options={reviewChecks} />
        </Form.Item>
        <Form.Item name="operatorLabel" label="操作人" rules={[{ required: true, min: 2, max: 50, message: '请输入 2–50 个字符' }]}><Input maxLength={50} /></Form.Item>
        {reviewSessionId && editable.bundle?.sessions[reviewSessionId]?.riskLevel === 'medium' && <Form.Item name="reviewerLabel" label="复核人" extra="中风险训练必须由不同于操作人的人员复核" dependencies={['operatorLabel']} rules={[
          { required: true, min: 2, max: 50, message: '请输入 2–50 个字符' },
          ({ getFieldValue }) => ({ validator: (_, value) => value?.trim() !== getFieldValue('operatorLabel')?.trim() ? Promise.resolve() : Promise.reject(new Error('复核人不能与操作人相同')) }),
        ]}><Input maxLength={50} /></Form.Item>}
        <Form.Item name="note" label="审核备注（可选）"><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
      </Form>
    </Modal>
    <Modal className="review-variant-modal" open={variantCandidates.length > 0} title="选择要插入的复习变体" width={820} okText={`插入草稿${selectedVariantIds.length ? `（${selectedVariantIds.length}）` : ''}`} okButtonProps={{ disabled: !selectedVariantIds.length }} onOk={insertVariants} onCancel={() => setVariantCandidates([])} destroyOnHidden>
      <Typography.Paragraph type="secondary">候选不会自动保存或发布。插入后请检查内容，再保存、校验并发布。</Typography.Paragraph>
      <Checkbox.Group className="review-variant-selector" value={selectedVariantIds} onChange={(values) => setSelectedVariantIds(values as string[])}>
        <div className="review-variant-candidates">
          {variantCandidates.map((variant) => <Card className={selectedVariantIds.includes(variant.variantId) ? 'review-variant-candidate selected' : 'review-variant-candidate'} size="small" key={variant.variantId} title={<Checkbox value={variant.variantId}><span className="review-variant-title">{variant.title}</span></Checkbox>}>
            <div className="review-variant-context">{variant.context}</div>
            <div className="review-variant-prompt">{variant.prompt}</div>
            <div className="review-variant-options">{variant.options.map((option, index) => <div className={`review-variant-option ${option.rating}`} key={option.id}>
              <span className="review-variant-option__index">{String.fromCharCode(65 + index)}</span>
              <span className="review-variant-option__text">{option.text}</span>
              <Tag color={option.rating === 'recommended' ? 'green' : option.rating === 'risky' ? 'gold' : 'red'}>{option.rating === 'recommended' ? '推荐' : option.rating === 'risky' ? '有风险' : '不推荐'}</Tag>
            </div>)}</div>
          </Card>)}
        </div>
      </Checkbox.Group>
    </Modal>
  </section>
}
