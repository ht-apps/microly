import { BulbOutlined, CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons'
import type { ReviewVariant, TrainingOption } from '@microly/content-schema'
import { App, Button, Card, Collapse, Empty, Form, Input, InputNumber, Modal, Select, Space, Tag, Tree, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'

import {
  cloneBundle, createCatalog, createSession, defaultOptions, deleteCatalog, deleteSession,
  renameCatalog, renameSession, replaceAtPath, uniqueId, validIdentifier,
  type EditableBundle,
} from '../features/content/content-workspace'
import type { EditorIssue } from './JsonEditor'
import { SortableList } from './SortableList'

type NodeSelection =
  | { type: 'library' }
  | { type: 'catalog'; catalogId: string }
  | { type: 'session'; sessionId: string }
  | { type: 'variant'; sessionId: string; variantId: string }

function parseNode(key: string): NodeSelection {
  const [type, first, second] = key.split(':')
  if (type === 'catalog' && first) return { type, catalogId: first }
  if (type === 'session' && first) return { type, sessionId: first }
  if (type === 'variant' && first && second) return { type, sessionId: first, variantId: second }
  return { type: 'library' }
}

function getAtPath(root: any, path: Array<string | number>) {
  return path.reduce((value, part) => value?.[part], root)
}

function fieldIssue(issues: EditorIssue[], path: string) {
  return issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`))
}

function TextField({ label, value, path, issues, onChange, readOnly, multiline, maxLength }: {
  label: string; value: unknown; path: string; issues: EditorIssue[]; onChange: (value: string) => void
  readOnly?: boolean; multiline?: boolean; maxLength?: number
}) {
  const issue = fieldIssue(issues, path)
  return <Form.Item label={label} validateStatus={issue ? (issue.severity === 'error' ? 'error' : 'warning') : undefined} help={issue?.message}>
    {multiline
      ? <Input.TextArea aria-label={label} value={String(value ?? '')} rows={3} maxLength={maxLength} showCount disabled={readOnly} onChange={(event) => onChange(event.target.value)} />
      : <Input aria-label={label} value={String(value ?? '')} maxLength={maxLength} showCount={Boolean(maxLength)} disabled={readOnly} onChange={(event) => onChange(event.target.value)} />}
  </Form.Item>
}

function AdvancedInfo({ values }: { values: Array<[string, unknown]> }) {
  return <Collapse ghost size="small" items={[{ key: 'advanced', label: '高级信息', children: <div className="advanced-fields">
    {values.map(([label, value]) => <div key={label}><span>{label}</span><code>{String(value ?? '—')}</code></div>)}
  </div> }]} />
}

function OptionsEditor({ options, path, issues, onChange, readOnly, onRename }: {
  options: TrainingOption[]; path: Array<string | number>; issues: EditorIssue[]
  onChange: (options: TrainingOption[]) => void; readOnly?: boolean
  onRename: (index: number) => void
}) {
  return <SortableList disabled={readOnly} items={options.map((option, index) => ({ id: option.id || `option-${index}`, option }))} onChange={(items) => onChange(items.map((item) => item.option))} renderItem={({ option }, index) => {
    const base = [...path, index]
    return <Card size="small" className="nested-form-card" title={<Space><Tag>{String.fromCharCode(65 + index)}</Tag><Typography.Text>{option.id}</Typography.Text></Space>} extra={!readOnly && <Button type="text" size="small" icon={<EditOutlined />} onClick={() => onRename(index)}>ID</Button>}>
      <TextField label="选项文本" value={option.text} path={[...base, 'text'].join('.')} issues={issues} maxLength={160} readOnly={readOnly} onChange={(value) => { const next = structuredClone(options); next[index]!.text = value; onChange(next) }} />
      <Form.Item label="评分"><Select value={option.rating} disabled={readOnly} options={[{ value: 'recommended', label: '推荐' }, { value: 'risky', label: '有风险' }, { value: 'not_recommended', label: '不推荐' }]} onChange={(value) => { const next = structuredClone(options); next[index]!.rating = value; onChange(next) }} /></Form.Item>
      {(['interpretation', 'strength', 'risk', 'condition'] as const).map((field) => <TextField key={field} label={{ interpretation: '对方理解', strength: '优点', risk: '风险', condition: '适用条件（可选）' }[field]} value={option.feedback?.[field]} path={[...base, 'feedback', field].join('.')} issues={issues} maxLength={140} readOnly={readOnly} onChange={(value) => {
        const next = structuredClone(options); next[index]!.feedback ??= { interpretation: '', strength: '', risk: '' }
        if (field === 'condition' && !value) delete next[index]!.feedback.condition
        else next[index]!.feedback[field] = value
        onChange(next)
      }} />)}
    </Card>
  }} />
}

export function ContentFormEditor({
  bundle, issues, selectedKey, onSelect, onChange, readOnly = false,
  onGenerateVariants, generateVariantsPending = false, generateVariantsDisabled = false,
  onWithdrawSession, withdrawDisabled = false,
}: {
  bundle: EditableBundle; issues: EditorIssue[]; selectedKey: string; onSelect: (key: string) => void
  onChange: (bundle: EditableBundle) => void; readOnly?: boolean
  onGenerateVariants?: (sessionId: string) => void; generateVariantsPending?: boolean; generateVariantsDisabled?: boolean
  onWithdrawSession?: (sessionId: string) => void; withdrawDisabled?: boolean
}) {
  const { modal, message } = App.useApp()
  const selection = parseNode(selectedKey)
  const [rename, setRename] = useState<{ label: string; current: string; apply: (value: string) => EditableBundle; selection?: (value: string) => string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [treeQuery, setTreeQuery] = useState('')
  useEffect(() => { if (rename) setRenameValue(rename.current) }, [rename])

  const treeData = useMemo(() => [{
    key: 'library', title: '课程设置', children: bundle.library.catalogIds.flatMap((catalogId) => {
      const catalog = bundle.catalogs[catalogId]
      if (!catalog) return []
      return [{ key: `catalog:${catalogId}`, title: catalog.title || catalogId, children: catalog.sessionIds.flatMap((sessionId) => {
        const session = bundle.sessions[sessionId]
        if (!session) return []
        return [{ key: `session:${sessionId}`, title: session.title || sessionId, children: (session.reviewVariants ?? []).map((variant) => ({ key: `variant:${sessionId}:${variant.variantId}`, title: `变体 · ${variant.title || variant.variantId}` })) }]
      }) }]
    }),
  }], [bundle])
  const visibleTreeData = useMemo(() => {
    const query = treeQuery.trim().toLocaleLowerCase()
    if (!query) return treeData
    const filterNode = (node: any): any | null => {
      const children = (node.children ?? []).map(filterNode).filter(Boolean)
      const matches = String(node.title).toLocaleLowerCase().includes(query) || String(node.key).toLocaleLowerCase().includes(query)
      return matches || children.length ? { ...node, children: matches ? node.children : children } : null
    }
    return treeData.map(filterNode).filter(Boolean)
  }, [treeData, treeQuery])
  const availableKeys = useMemo(() => new Set<string>(['library', ...treeData[0]!.children!.flatMap((catalog: any) => [catalog.key, ...catalog.children.flatMap((session: any) => [session.key, ...session.children.map((variant: any) => variant.key)])])]), [treeData])
  useEffect(() => { if (!availableKeys.has(selectedKey)) onSelect('library') }, [availableKeys, onSelect, selectedKey])

  const patch = (path: Array<string | number>, value: unknown) => onChange(replaceAtPath(bundle, path, value))
  const renameNested = (path: Array<string | number>, idField: string, siblings: any[], nextSelection?: (value: string) => string) => {
    const target = getAtPath(bundle, path)
    setRename({ label: `${idField} ID`, current: target[idField], apply: (value) => {
      if (!validIdentifier(value)) throw new Error('ID 只能包含小写英文、数字和连字符')
      if (value !== target[idField] && siblings.some((item) => item[idField] === value)) throw new Error('ID 已存在')
      const next = cloneBundle(bundle); getAtPath(next, path)[idField] = value; return next
    }, selection: nextSelection })
  }
  const confirmRename = () => {
    if (!rename) return
    try {
      const value = renameValue.trim()
      onChange(rename.apply(value))
      if (rename.selection) onSelect(rename.selection(value))
      setRename(null)
      message.success('ID 已更新')
    } catch (cause) { message.error(cause instanceof Error ? cause.message : 'ID 无效') }
  }

  const libraryForm = () => <Form layout="vertical" className="visual-form">
    <Typography.Title level={4}>课程设置</Typography.Title>
    <TextField label="课程标题" value={bundle.library.title} path="library.title" issues={issues} maxLength={50} readOnly={readOnly} onChange={(value) => patch(['library', 'title'], value)} />
    <TextField label="课程描述" value={bundle.library.description} path="library.description" issues={issues} maxLength={200} multiline readOnly={readOnly} onChange={(value) => patch(['library', 'description'], value)} />
    <div className="form-section-title"><Typography.Title level={5}>章节顺序</Typography.Title>{!readOnly && <Button size="small" icon={<PlusOutlined />} onClick={() => { const created = createCatalog(bundle); onChange(created.bundle); onSelect(`catalog:${created.id}`) }}>新建章节</Button>}</div>
    <SortableList disabled={readOnly} items={bundle.library.catalogIds.map((id) => ({ id }))} onChange={(items) => patch(['library', 'catalogIds'], items.map((item) => item.id))} renderItem={(item) => <button className="form-link-row" type="button" onClick={() => onSelect(`catalog:${item.id}`)}>{bundle.catalogs[item.id]?.title ?? item.id}</button>} />
    <AdvancedInfo values={[["libraryId", bundle.library.libraryId], ["schemaVersion", bundle.library.schemaVersion], ["contentVersion", bundle.library.contentVersion], ["releaseVersion", bundle.releaseVersion]]} />
  </Form>

  const catalogForm = (catalogId: string) => {
    const catalog = bundle.catalogs[catalogId]
    if (!catalog) return <Empty description="章节不存在" />
    const updateSkill = (value: string) => {
      const next = cloneBundle(bundle); next.catalogs[catalogId]!.skill = value
      catalog.sessionIds.forEach((id) => { if (next.sessions[id]) next.sessions[id]!.skill = value })
      onChange(next)
    }
    return <Form layout="vertical" className="visual-form">
      <div className="form-title-row"><Typography.Title level={4}>{catalog.title}</Typography.Title>{!readOnly && <Space><Button icon={<EditOutlined />} onClick={() => setRename({ label: '章节 ID', current: catalogId, apply: (value) => renameCatalog(bundle, catalogId, value), selection: (value) => `catalog:${value}` })}>重命名 ID</Button><Button danger icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: `删除章节“${catalog.title}”？`, content: catalog.sessionIds.length ? '该章节仍包含训练，无法删除。' : '删除后不可撤销，但可在保存前离开草稿放弃修改。', okButtonProps: { danger: true, disabled: Boolean(catalog.sessionIds.length) }, onOk: () => { onChange(deleteCatalog(bundle, catalogId)); onSelect('library') } })}>删除</Button></Space>}</div>
      <TextField label="章节标题" value={catalog.title} path={`catalogs.${catalogId}.title`} issues={issues} maxLength={50} readOnly={readOnly} onChange={(value) => patch(['catalogs', catalogId, 'title'], value)} />
      <TextField label="技能 ID" value={catalog.skill} path={`catalogs.${catalogId}.skill`} issues={issues} readOnly={readOnly} onChange={updateSkill} />
      <TextField label="章节描述" value={catalog.description} path={`catalogs.${catalogId}.description`} issues={issues} maxLength={160} multiline readOnly={readOnly} onChange={(value) => patch(['catalogs', catalogId, 'description'], value)} />
      <div className="form-section-title"><Typography.Title level={5}>训练顺序</Typography.Title>{!readOnly && <Button size="small" icon={<PlusOutlined />} onClick={() => { const created = createSession(bundle, catalogId); onChange(created.bundle); onSelect(`session:${created.id}`) }}>新建训练</Button>}</div>
      <SortableList disabled={readOnly} items={catalog.sessionIds.map((id) => ({ id }))} onChange={(items) => patch(['catalogs', catalogId, 'sessionIds'], items.map((item) => item.id))} renderItem={(item) => <button className="form-link-row" type="button" onClick={() => onSelect(`session:${item.id}`)}>{bundle.sessions[item.id]?.title ?? item.id}</button>} />
      <AdvancedInfo values={[["catalogId", catalog.catalogId], ["schemaVersion", catalog.schemaVersion], ["contentVersion", catalog.contentVersion]]} />
    </Form>
  }

  const optionEditor = (options: TrainingOption[], path: Array<string | number>) => <OptionsEditor options={options ?? []} path={path} issues={issues} readOnly={readOnly} onChange={(value) => patch(path, value)} onRename={(index) => renameNested([...path, index], 'id', options)} />

  const cardForm = (sessionId: string, card: any, cardIndex: number) => {
    const base = ['sessions', sessionId, 'cards', cardIndex] as Array<string | number>
    const path = (field: string) => [...base, field].join('.')
    const text = (label: string, field: string, maxLength: number, multiline = false) => <TextField label={label} value={card[field]} path={path(field)} issues={issues} maxLength={maxLength} multiline={multiline} readOnly={readOnly} onChange={(value) => patch([...base, field], value)} />
    return <div className="card-form">
      <div className="card-form__id"><Tag>{card.type}</Tag><code>{card.id}</code>{!readOnly && <Button type="link" size="small" onClick={() => renameNested(base, 'id', bundle.sessions[sessionId]!.cards)}>重命名</Button>}</div>
      {card.type === 'scenario' && <>{text('眉标', 'eyebrow', 30)}{text('标题', 'title', 40)}{text('情境', 'context', 120, true)}{text('问题', 'question', 50)}</>}
      {card.type === 'choice' && <>{text('选择提示', 'prompt', 60)}{optionEditor(card.options, [...base, 'options'])}</>}
      {card.type === 'feedback' && <>{text('标题', 'title', 40)}{text('对比标签', 'comparisonLabel', 30)}</>}
      {card.type === 'principle' && <>{text('标题', 'title', 40)}{text('摘要', 'summary', 120, true)}{text('公式', 'formula', 60)}{text('反例', 'counterexample', 160, true)}{text('参考表达', 'example', 200, true)}</>}
      {card.type === 'practice' && <>{text('标题', 'title', 40)}{text('练习提示', 'prompt', 160, true)}<Space size="large"><Form.Item label="最少字数"><InputNumber min={1} max={200} value={card.minLength} disabled={readOnly} onChange={(value) => patch([...base, 'minLength'], value ?? 1)} /></Form.Item><Form.Item label="最多字数"><InputNumber min={1} max={200} value={card.maxLength} disabled={readOnly} onChange={(value) => patch([...base, 'maxLength'], value ?? 200)} /></Form.Item></Space><DimensionsEditor dimensions={card.dimensions ?? []} path={[...base, 'dimensions']} issues={issues} readOnly={readOnly} onChange={(value) => patch([...base, 'dimensions'], value)} onRename={(index) => renameNested([...base, 'dimensions', index], 'id', card.dimensions)} />{text('参考答案', 'referenceAnswer', 240, true)}{text('说明', 'disclaimer', 120, true)}</>}
      {card.type === 'completion' && <>{text('标题', 'title', 40)}{text('完成摘要', 'summary', 120, true)}{text('带走一句', 'takeaway', 100, true)}</>}
    </div>
  }

  const sessionForm = (sessionId: string) => {
    const session = bundle.sessions[sessionId]
    if (!session) return <Empty description="训练不存在" />
    const sessionPath = `sessions.${sessionId}`
    const variants = session.reviewVariants ?? []
    return <Form layout="vertical" className="visual-form">
      <div className="form-title-row"><Typography.Title level={4}>{session.title}</Typography.Title>{(!readOnly || onWithdrawSession) && <Space>{!readOnly && <><Button icon={<EditOutlined />} onClick={() => setRename({ label: '训练 ID', current: sessionId, apply: (value) => renameSession(bundle, sessionId, value), selection: (value) => `session:${value}` })}>重命名 ID</Button><Button danger icon={<DeleteOutlined />} onClick={() => {
        const owning = Object.values(bundle.catalogs).filter((catalog) => catalog.sessionIds.includes(sessionId))
        const removed = owning.filter((catalog) => catalog.sessionIds.length === 1).map((catalog) => catalog.title)
        modal.confirm({ title: `删除训练“${session.title}”？`, content: removed.length ? `同时删除将变空的章节：${removed.join('、')}` : '将同时清理所有章节引用。', okButtonProps: { danger: true }, onOk: () => { try { onChange(deleteSession(bundle, sessionId).bundle); onSelect('library') } catch (cause) { message.error(cause instanceof Error ? cause.message : '无法删除') } } })
      }}>删除</Button></>}{onWithdrawSession && <Button danger icon={<StopOutlined />} disabled={withdrawDisabled} onClick={() => onWithdrawSession(sessionId)}>下架</Button>}</Space>}</div>
      <TextField label="训练标题" value={session.title} path={`${sessionPath}.title`} issues={issues} maxLength={50} readOnly={readOnly} onChange={(value) => patch(['sessions', sessionId, 'title'], value)} />
      <TextField label="学习目标" value={session.objective} path={`${sessionPath}.objective`} issues={issues} maxLength={120} multiline readOnly={readOnly} onChange={(value) => patch(['sessions', sessionId, 'objective'], value)} />
      <Space size="large" wrap><Form.Item label="难度"><Select style={{ width: 120 }} value={session.difficulty} disabled={readOnly} options={['L1', 'L2', 'L3', 'L4'].map((value) => ({ value }))} onChange={(value) => patch(['sessions', sessionId, 'difficulty'], value)} /></Form.Item><Form.Item label="风险"><Select style={{ width: 140 }} value={session.riskLevel} disabled={readOnly} options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} onChange={(value) => patch(['sessions', sessionId, 'riskLevel'], value)} /></Form.Item><Form.Item label="预计分钟"><InputNumber min={1} max={10} value={session.estimatedMinutes} disabled={readOnly} onChange={(value) => patch(['sessions', sessionId, 'estimatedMinutes'], value ?? 3)} /></Form.Item></Space>
      <Collapse className="card-collapse" items={session.cards.map((card: any, index) => ({ key: card.id || String(index), label: `${String(index + 1).padStart(2, '0')} · ${card.type}`, children: cardForm(sessionId, card, index) }))} />
      <div className="form-section-title"><Typography.Title level={5}>复习变体</Typography.Title><Space>{!readOnly && <Button size="small" icon={<PlusOutlined />} disabled={variants.length >= 5} onClick={() => {
        const id = uniqueId(variants.map((item) => item.variantId), `review-${variants.length + 1}`, 'review-variant')
        const next: ReviewVariant = { variantId: id, title: '新复习情境', context: '请用四十到一百二十个字描述一个与原训练目标一致、但具体条件有所变化的匿名职场情境。', question: '你会如何回应？', prompt: '选择一句更合适的表达', options: defaultOptions(id) }
        patch(['sessions', sessionId, 'reviewVariants'], [...variants, next]); onSelect(`variant:${sessionId}:${id}`)
      }}>新增变体</Button>}{onGenerateVariants && <Button size="small" icon={<BulbOutlined />} loading={generateVariantsPending} disabled={generateVariantsDisabled} onClick={() => onGenerateVariants(sessionId)}>生成变体</Button>}</Space></div>
      <SortableList disabled={readOnly} items={variants.map((variant) => ({ id: variant.variantId, variant }))} onChange={(items) => patch(['sessions', sessionId, 'reviewVariants'], items.map((item) => item.variant))} renderItem={({ variant }) => <button className="form-link-row" type="button" onClick={() => onSelect(`variant:${sessionId}:${variant.variantId}`)}>{variant.title}</button>} />
      <AdvancedInfo values={[["sessionId", session.sessionId], ["skill", session.skill], ["schemaVersion", session.schemaVersion], ["contentVersion", session.contentVersion]]} />
    </Form>
  }

  const variantForm = (sessionId: string, variantId: string) => {
    const session = bundle.sessions[sessionId]
    const index = session?.reviewVariants?.findIndex((item) => item.variantId === variantId) ?? -1
    const variant = index >= 0 ? session?.reviewVariants[index] : null
    if (!session || !variant) return <Empty description="变体不存在" />
    const base = ['sessions', sessionId, 'reviewVariants', index] as Array<string | number>
    return <Form layout="vertical" className="visual-form">
      <div className="form-title-row"><Typography.Title level={4}>{variant.title}</Typography.Title>{!readOnly && <Space><Button icon={<EditOutlined />} onClick={() => renameNested(base, 'variantId', session.reviewVariants, (value) => `variant:${sessionId}:${value}`)}>重命名 ID</Button><Button icon={<CopyOutlined />} disabled={session.reviewVariants.length >= 5} onClick={() => {
        const copy = structuredClone(variant); copy.variantId = uniqueId(session.reviewVariants.map((item) => item.variantId), `${variant.variantId}-copy`, 'review-copy'); copy.title = `${variant.title}（副本）`; patch(['sessions', sessionId, 'reviewVariants'], [...session.reviewVariants, copy]); onSelect(`variant:${sessionId}:${copy.variantId}`)
      }}>复制</Button><Button danger icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: `删除变体“${variant.title}”？`, okButtonProps: { danger: true }, onOk: () => { patch(['sessions', sessionId, 'reviewVariants'], session.reviewVariants.filter((item) => item.variantId !== variantId)); onSelect(`session:${sessionId}`) } })}>删除</Button></Space>}</div>
      <TextField label="标题" value={variant.title} path={[...base, 'title'].join('.')} issues={issues} maxLength={40} readOnly={readOnly} onChange={(value) => patch([...base, 'title'], value)} />
      <TextField label="情境" value={variant.context} path={[...base, 'context'].join('.')} issues={issues} maxLength={120} multiline readOnly={readOnly} onChange={(value) => patch([...base, 'context'], value)} />
      <TextField label="问题" value={variant.question} path={[...base, 'question'].join('.')} issues={issues} maxLength={50} readOnly={readOnly} onChange={(value) => patch([...base, 'question'], value)} />
      <TextField label="选择提示" value={variant.prompt} path={[...base, 'prompt'].join('.')} issues={issues} maxLength={60} readOnly={readOnly} onChange={(value) => patch([...base, 'prompt'], value)} />
      {optionEditor(variant.options, [...base, 'options'])}
      <AdvancedInfo values={[["variantId", variant.variantId]]} />
    </Form>
  }

  return <div className="content-form-editor">
    <aside className="content-form-tree"><Input.Search aria-label="搜索内容树" allowClear placeholder="搜索章节、训练或变体" value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} /><Tree blockNode defaultExpandAll selectedKeys={[selectedKey]} treeData={visibleTreeData} onSelect={(keys) => keys[0] && onSelect(String(keys[0]))} /></aside>
    <main className="content-form-fields">{selection.type === 'library' ? libraryForm() : selection.type === 'catalog' ? catalogForm(selection.catalogId) : selection.type === 'session' ? sessionForm(selection.sessionId) : variantForm(selection.sessionId, selection.variantId)}</main>
    <Modal open={Boolean(rename)} title={`重命名${rename?.label ?? ' ID'}`} okText="确认并更新引用" onOk={confirmRename} onCancel={() => setRename(null)}>
      <Typography.Paragraph type="secondary">新 ID 必须唯一。章节和训练的所有内部引用会同步更新。</Typography.Paragraph>
      <Input value={renameValue} status={renameValue && !validIdentifier(renameValue) ? 'error' : undefined} onChange={(event) => setRenameValue(event.target.value)} onPressEnter={confirmRename} />
    </Modal>
  </div>
}

function DimensionsEditor({ dimensions, path, issues, onChange, readOnly, onRename }: {
  dimensions: Array<{ id: string; title: string; description: string; keywords: string[] }>
  path: Array<string | number>; issues: EditorIssue[]; onChange: (value: any[]) => void; readOnly?: boolean; onRename: (index: number) => void
}) {
  return <div className="dimensions-editor"><div className="form-section-title"><Typography.Title level={5}>点评维度</Typography.Title>{!readOnly && <Button size="small" icon={<PlusOutlined />} disabled={dimensions.length >= 4} onClick={() => onChange([...dimensions, { id: uniqueId(dimensions.map((item) => item.id), `dimension-${dimensions.length + 1}`, 'dimension'), title: '新维度', description: '请填写这个维度的判定标准。', keywords: ['关键词'] }])}>新增维度</Button>}</div>
    <SortableList disabled={readOnly} items={dimensions.map((dimension) => ({ id: dimension.id, dimension }))} onChange={(items) => onChange(items.map((item) => item.dimension))} renderItem={({ dimension }, index) => <Card size="small" className="nested-form-card" title={dimension.title} extra={!readOnly && <Space><Button type="text" size="small" icon={<EditOutlined />} onClick={() => onRename(index)}>ID</Button><Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={dimensions.length <= 1} onClick={() => onChange(dimensions.filter((_, itemIndex) => itemIndex !== index))} /></Space>}>
      <TextField label="维度标题" value={dimension.title} path={[...path, index, 'title'].join('.')} issues={issues} maxLength={30} readOnly={readOnly} onChange={(value) => { const next = structuredClone(dimensions); next[index]!.title = value; onChange(next) }} />
      <TextField label="判定说明" value={dimension.description} path={[...path, index, 'description'].join('.')} issues={issues} maxLength={100} multiline readOnly={readOnly} onChange={(value) => { const next = structuredClone(dimensions); next[index]!.description = value; onChange(next) }} />
      <Form.Item label="关键词（用逗号分隔）"><Input value={(dimension.keywords ?? []).join(', ')} disabled={readOnly} onChange={(event) => { const next = structuredClone(dimensions); next[index]!.keywords = event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean); onChange(next) }} /></Form.Item>
    </Card>} />
  </div>
}
