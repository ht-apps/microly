import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { AdminContentDraft, AdminContentRelease, AdminFeedback, AdminMetrics } from '@microly/api-contract'
import { TrainingContentBundleSchema, type TrainingContentBundle, type TrainingSession } from '@microly/content-schema'

import { ApiError, adminRequest, clearAdminToken, readAdminToken, saveAdminToken } from './api'
import microlyMark from './assets/microly-mark.png'
import './App.css'

type Page = 'dashboard' | 'content' | 'feedback'
type Issue = { path: string; message: string; severity: 'error' | 'warning' }

const feedbackStatusLabels = { new: '待处理', in_progress: '处理中', resolved: '已解决', dismissed: '已忽略' } as const
const categoryLabels: Record<string, string> = { content_error: '内容错误', product_suggestion: '产品建议', inappropriate_content: '不当内容' }
const funnelLabels: Record<string, string> = { app_open: '首次打开', onboarding_view: '看到引导', training_start: '开始训练', option_select: '确认选项', training_complete: '完成训练', wechat_login_success: '微信登录' }

function Login({ onLogin }: { onLogin: (token: string) => Promise<void> }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (token.trim().length < 32) return setError('请输入至少 32 位的管理令牌。')
    setBusy(true); setError('')
    try { await onLogin(token.trim()) } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 503 ? 'API 尚未配置 ADMIN_API_TOKEN。' : '管理令牌无效，请重新输入。')
    } finally { setBusy(false) }
  }
  return <main className="login-shell">
    <form className="login-card" onSubmit={submit}>
      <img className="brand-mark" src={microlyMark} alt="微习" />
      <p className="eyebrow">MICROLY OPERATIONS</p>
      <h1>进入运营后台</h1>
      <p className="muted">使用本地 API 配置的共享管理令牌。令牌只在当前浏览器会话中保存。</p>
      <label>管理令牌<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoFocus /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? '正在验证…' : '验证并进入'}</button>
    </form>
  </main>
}

function Dashboard({ token, unauthorized }: ViewProps) {
  const [window, setWindow] = useState<'7d' | '30d'>('7d')
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setError(''); adminRequest<AdminMetrics>(`/v1/admin/metrics?window=${window}`, token).then(setMetrics).catch((cause) => cause instanceof ApiError && cause.status === 401 ? unauthorized() : setError('数据暂时无法加载。')) }, [token, unauthorized, window])
  const maxDaily = Math.max(1, ...(metrics?.daily.flatMap((day) => [day.starts, day.completions]) ?? []))
  return <section>
    <header className="page-heading"><div><p className="eyebrow">运营概览</p><h1>学习漏斗</h1><p className="muted">观察新用户从打开到登录保存的关键流失节点。</p></div><div className="segmented"><button className={window === '7d' ? 'active' : ''} onClick={() => setWindow('7d')}>近 7 天</button><button className={window === '30d' ? 'active' : ''} onClick={() => setWindow('30d')}>近 30 天</button></div></header>
    {error && <div className="notice error">{error}</div>}
    {!metrics ? <div className="panel loading">正在汇总数据…</div> : <>
      <div className="funnel-grid">{metrics.funnel.map((stage) => <article className="metric-card" key={stage.name}><span>{funnelLabels[stage.name]}</span><strong>{stage.accounts}</strong><small>{stage.conversionRate === null ? '窗口内首次用户' : `上一步转化 ${(stage.conversionRate * 100).toFixed(1)}%`}</small></article>)}</div>
      <div className="dashboard-grid">
        <article className="panel"><div className="panel-heading"><h2>训练趋势</h2><span>UTC 自然日</span></div>{metrics.daily.length ? <div className="chart">{metrics.daily.map((day) => <div className="chart-column" key={day.date}><div className="bars"><i className="bar start" style={{ height: `${Math.max(4, day.starts / maxDaily * 100)}%` }} title={`开始 ${day.starts}`} /><i className="bar complete" style={{ height: `${Math.max(4, day.completions / maxDaily * 100)}%` }} title={`完成 ${day.completions}`} /></div><small>{day.date.slice(5)}</small></div>)}</div> : <Empty text="窗口内还没有训练事件" />}</article>
        <article className="panel"><div className="panel-heading"><h2>反馈待办</h2><strong>{metrics.feedback.byStatus.new + metrics.feedback.byStatus.in_progress}</strong></div><div className="status-summary">{Object.entries(feedbackStatusLabels).map(([status, label]) => <div key={status}><span className={`status-dot ${status}`} />{label}<b>{metrics.feedback.byStatus[status as keyof typeof metrics.feedback.byStatus]}</b></div>)}</div></article>
      </div>
      <article className="panel"><div className="panel-heading"><h2>训练表现</h2><span>按完成数排序</span></div>{metrics.sessions.length ? <div className="data-table"><div className="table-row table-head"><span>训练 ID</span><span>开始</span><span>完成</span><span>完成率</span></div>{metrics.sessions.map((session) => <div className="table-row" key={session.sessionId}><b>{session.sessionId}</b><span>{session.starts}</span><span>{session.completions}</span><span>{(session.completionRate * 100).toFixed(1)}%</span></div>)}</div> : <Empty text="窗口内还没有可比较的训练" />}</article>
    </>}
  </section>
}

function Empty({ text }: { text: string }) { return <div className="empty">{text}</div> }

function CardPreview({ session }: { session: TrainingSession | null }) {
  if (!session) return <Empty text="选择一组训练后预览卡片" />
  return <div className="phone-preview"><div className="phone-top"><small>{session.skill} · {session.difficulty}</small><h3>{session.title}</h3><p>{session.objective}</p></div>{session.cards.map((card) => <article className="preview-card" key={card.id}><span>{card.type}</span>{card.type === 'scenario' && <><h4>{card.title}</h4><p>{card.context}</p><b>{card.question}</b></>}{card.type === 'choice' && <><h4>{card.prompt}</h4>{card.options.map((option) => <div className={`preview-option ${option.rating}`} key={option.id}>{option.text}</div>)}</>}{card.type === 'feedback' && <><h4>{card.title}</h4><p>{card.comparisonLabel}</p></>}{card.type === 'principle' && <><h4>{card.title}</h4><p>{card.summary}</p><code>{card.formula}</code></>}{card.type === 'practice' && <><h4>{card.title}</h4><p>{card.prompt}</p><small>{card.minLength}–{card.maxLength} 字 · {card.dimensions.length} 个维度</small></>}{card.type === 'completion' && <><h4>{card.title}</h4><p>{card.summary}</p><b>{card.takeaway}</b></>}</article>)}</div>
}

function ContentManager({ token, unauthorized }: ViewProps) {
  const [releases, setReleases] = useState<AdminContentRelease[]>([])
  const [drafts, setDrafts] = useState<AdminContentDraft[]>([])
  const [draft, setDraft] = useState<AdminContentDraft | null>(null)
  const [editor, setEditor] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = (() => { try { const result = TrainingContentBundleSchema.safeParse(JSON.parse(editor)); return result.success ? result.data : null } catch { return null } })()
  const previewSession = parsed?.sessions[selectedSession] ?? (parsed ? Object.values(parsed.sessions)[0] : null) ?? null
  const load = useCallback(async () => {
    try {
      const value = await adminRequest<{ releases: AdminContentRelease[]; drafts: AdminContentDraft[] }>('/v1/admin/content/releases', token)
      setReleases(value.releases); setDrafts(value.drafts)
    } catch (cause) { if (cause instanceof ApiError && cause.status === 401) unauthorized(); else setNotice('内容列表暂时无法加载。') }
  }, [token, unauthorized])
  useEffect(() => { void load() }, [load])
  const openDraft = (value: AdminContentDraft) => { setDraft(value); setEditor(JSON.stringify(value.bundle, null, 2)); setIssues([]); const bundle = TrainingContentBundleSchema.safeParse(value.bundle); setSelectedSession(bundle.success ? Object.keys(bundle.data.sessions)[0] ?? '' : '') }
  const createDraft = async (version?: number) => { setBusy(true); try { const value = version ? await adminRequest<AdminContentDraft>(`/v1/admin/content/releases/${version}/rollback-draft`, token, { method: 'POST' }) : await adminRequest<AdminContentDraft>('/v1/admin/content/drafts', token, { method: 'POST', body: JSON.stringify({}) }); setDrafts((items) => [value, ...items]); openDraft(value); setNotice(version ? `已基于 v${version} 创建回滚草稿，确认后再发布。` : '已从当前版本创建草稿。') } catch { setNotice('草稿创建失败。') } finally { setBusy(false) } }
  const save = async () => {
    if (!draft) return
    let bundle: unknown; try { bundle = JSON.parse(editor) } catch { return setIssues([{ path: '', message: 'JSON 语法错误，请先修正。', severity: 'error' }]) }
    setBusy(true); try { const value = await adminRequest<AdminContentDraft>(`/v1/admin/content/drafts/${draft.id}`, token, { method: 'PUT', body: JSON.stringify({ revision: draft.revision, bundle }) }); openDraft(value); setDrafts((items) => items.map((item) => item.id === value.id ? value : item)); setNotice('草稿已保存。') } catch (cause) { setNotice(cause instanceof ApiError && cause.code === 'draft_conflict' ? '草稿已被更新，请重新加载后再编辑。' : '保存失败。') } finally { setBusy(false) }
  }
  const validate = async () => { if (!draft) return; setBusy(true); try { const value = await adminRequest<{ valid: boolean; issues: Issue[]; normalizedBundle: TrainingContentBundle | null }>(`/v1/admin/content/drafts/${draft.id}/validate`, token, { method: 'POST' }); setIssues(value.issues); setNotice(value.valid ? '校验通过，可以发布。' : '校验未通过，请按路径修正。') } catch { setNotice('校验失败。') } finally { setBusy(false) } }
  const publish = async () => { if (!draft) return; const reason = window.prompt('填写本次发布原因（至少 3 个字）'); if (!reason || reason.trim().length < 3 || !window.confirm(`确认发布草稿？发布后将生成高于 v${releases[0]?.releaseVersion ?? 0} 的新版本。`)) return; setBusy(true); try { const value = await adminRequest<{ releaseVersion: number }>(`/v1/admin/content/drafts/${draft.id}/publish`, token, { method: 'POST', body: JSON.stringify({ revision: draft.revision, reason }) }); setNotice(`v${value.releaseVersion} 已发布。`); setDraft(null); setEditor(''); await load() } catch (cause) { setNotice(cause instanceof ApiError ? cause.message : '发布失败。') } finally { setBusy(false) } }
  const withdraw = async () => { if (!selectedSession) return; const reason = window.prompt(`填写下架 ${selectedSession} 的原因`); if (!reason || reason.trim().length < 3 || !window.confirm('确认立即下架？系统会直接发布一个移除该训练的新版本。')) return; setBusy(true); try { const value = await adminRequest<{ releaseVersion: number }>(`/v1/admin/content/current/sessions/${selectedSession}/withdraw`, token, { method: 'POST', body: JSON.stringify({ confirmation: 'WITHDRAW', reason }) }); setNotice(`训练已下架并发布为 v${value.releaseVersion}。`); await load() } catch (cause) { setNotice(cause instanceof ApiError ? cause.message : '下架失败。') } finally { setBusy(false) } }
  return <section><header className="page-heading"><div><p className="eyebrow">内容运营</p><h1>版本与草稿</h1><p className="muted">发布快照不可修改；回滚和下架都会生成更高版本。</p></div><button className="primary compact" disabled={busy || !releases.length} onClick={() => createDraft()}>新建草稿</button></header>{notice && <div className="notice">{notice}</div>}
    <div className="content-layout"><aside className="side-panel"><h3>草稿</h3>{drafts.filter((item) => item.status === 'draft').map((item) => <button className={draft?.id === item.id ? 'side-item active' : 'side-item'} key={item.id} onClick={() => openDraft(item)}><b>基于 v{item.baseReleaseVersion}</b><small>修订 {item.revision} · {new Date(item.updatedAt).toLocaleString()}</small></button>)}{!drafts.some((item) => item.status === 'draft') && <Empty text="暂无待处理草稿" />}<h3>发布历史</h3>{releases.map((release, index) => <div className="release-item" key={release.releaseVersion}><div><b>v{release.releaseVersion} {index === 0 && <em>当前</em>}</b><small>{release.sessionCount} 组 · {new Date(release.publishedAt).toLocaleString()}</small></div><button onClick={() => createDraft(release.releaseVersion)}>回滚草稿</button></div>)}</aside>
      <div className="editor-panel">{draft ? <><div className="toolbar"><b>草稿 · 修订 {draft.revision}</b><div><button onClick={() => { try { setEditor(JSON.stringify(JSON.parse(editor), null, 2)) } catch { setIssues([{ path: '', message: 'JSON 语法错误。', severity: 'error' }]) } }}>格式化</button><button disabled={busy} onClick={save}>保存</button><button disabled={busy} onClick={validate}>校验</button><button className="primary compact" disabled={busy} onClick={publish}>发布</button></div></div><textarea className="json-editor" spellCheck={false} value={editor} onChange={(event) => setEditor(event.target.value)} /><div className="issues"><h3>校验结果</h3>{issues.length ? issues.map((issue, index) => <div className={`issue ${issue.severity}`} key={`${issue.path}-${index}`}><code>{issue.path || '$'}</code><span>{issue.message}</span></div>) : <Empty text="保存后运行校验，查看发布问题" />}</div></> : <Empty text="选择现有草稿，或从当前版本新建草稿" />}</div>
      <aside className="preview-panel"><div className="preview-toolbar"><select value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>{parsed && Object.values(parsed.sessions).map((session) => <option value={session.sessionId} key={session.sessionId}>{session.title}</option>)}</select><button className="danger-link" disabled={!selectedSession || busy} onClick={withdraw}>下架当前训练</button></div><CardPreview session={previewSession} /></aside></div>
  </section>
}

function FeedbackManager({ token, unauthorized }: ViewProps) {
  const [items, setItems] = useState<AdminFeedback[]>([])
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<AdminFeedback | null>(null)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => { try { const query = new URLSearchParams(); if (status) query.set('status', status); if (category) query.set('category', category); const value = await adminRequest<{ items: AdminFeedback[] }>(`/v1/admin/feedback?${query}`, token); setItems(value.items) } catch (cause) { if (cause instanceof ApiError && cause.status === 401) unauthorized(); else setNotice('反馈暂时无法加载。') } }, [status, category, token, unauthorized])
  useEffect(() => { void load() }, [load])
  const update = async (nextStatus: AdminFeedback['status']) => { if (!selected) return; try { const value = await adminRequest<AdminFeedback>(`/v1/admin/feedback/${selected.id}`, token, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, internalNote: note.trim() || null }) }); setSelected(value); setItems((values) => values.map((item) => item.id === value.id ? value : item)); setNotice('反馈状态已更新。') } catch { setNotice('更新失败。') } }
  return <section><header className="page-heading"><div><p className="eyebrow">用户声音</p><h1>反馈处理</h1><p className="muted">反馈正文仅用于处理问题，不与主动表达草稿关联。</p></div><div className="filters"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(feedbackStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部类型</option>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></header>{notice && <div className="notice">{notice}</div>}<div className="feedback-layout"><div className="feedback-list">{items.map((item) => <button className={selected?.id === item.id ? 'feedback-item active' : 'feedback-item'} key={item.id} onClick={() => { setSelected(item); setNote(item.internalNote ?? '') }}><div><span className={`status-pill ${item.status}`}>{feedbackStatusLabels[item.status]}</span><small>{categoryLabels[item.category]}</small></div><p>{item.detail}</p><time>{new Date(item.createdAt).toLocaleString()}</time></button>)}{!items.length && <Empty text="当前筛选条件下没有反馈" />}</div><aside className="feedback-detail">{selected ? <><div className="panel-heading"><h2>{categoryLabels[selected.category]}</h2><span className={`status-pill ${selected.status}`}>{feedbackStatusLabels[selected.status]}</span></div><p className="feedback-copy">{selected.detail}</p>{selected.sessionId && <div className="context">训练：{selected.sessionId} · 内容 v{selected.contentVersion}</div>}<label>内部备注<textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label><small className="count">{note.length}/500</small><div className="action-row"><button onClick={() => update('in_progress')}>标记处理中</button><button className="primary compact" onClick={() => update('resolved')}>标记已解决</button><button onClick={() => update('dismissed')}>忽略</button></div></> : <Empty text="选择一条反馈查看详情" />}</aside></div></section>
}

type ViewProps = { token: string; unauthorized: () => void }

export default function App() {
  const [token, setToken] = useState(readAdminToken)
  const [page, setPage] = useState<Page>('dashboard')
  const login = async (value: string) => { await adminRequest('/v1/admin/session', value); saveAdminToken(value); setToken(value) }
  const logout = () => { clearAdminToken(); setToken('') }
  if (!token) return <Login onLogin={login} />
  const props = { token, unauthorized: logout }
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><img className="brand-mark" src={microlyMark} alt="微习" /><div><b>Microly</b><small>运营后台</small></div></div><nav><button className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>数据概览</button><button className={page === 'content' ? 'active' : ''} onClick={() => setPage('content')}>内容管理</button><button className={page === 'feedback' ? 'active' : ''} onClick={() => setPage('feedback')}>反馈处理</button></nav><button className="logout" onClick={logout}>退出后台</button></aside><main className="workspace">{page === 'dashboard' && <Dashboard {...props} />}{page === 'content' && <ContentManager {...props} />}{page === 'feedback' && <FeedbackManager {...props} />}</main></div>
}
