import type { TrainingContentBundle } from '@microly/content-schema'

export type EditableBundle = TrainingContentBundle & Record<string, unknown>

const identifierPattern = /^[a-z0-9-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export type EditableBundleParseResult = {
  bundle: EditableBundle | null
  error: string | null
  errorPath: string | null
}

export function parseEditableBundle(text: string): EditableBundleParseResult {
  let value: unknown
  try { value = JSON.parse(text) } catch { return { bundle: null, error: 'JSON 语法错误，请先修正后再切换到表单。', errorPath: null } }
  if (!isRecord(value) || !isRecord(value.library) || !isRecord(value.catalogs) || !isRecord(value.sessions)) {
    return { bundle: null, error: '内容包必须包含 library、catalogs 和 sessions 对象。', errorPath: '$' }
  }
  const expectedCardTypes = ['scenario', 'choice', 'feedback', 'principle', 'practice', 'completion']
  for (const [sessionId, session] of Object.entries(value.sessions)) {
    if (!isRecord(session) || !Array.isArray(session.cards)) {
      return { bundle: null, error: `训练 ${sessionId} 缺少可识别的 cards 数组。`, errorPath: `sessions.${sessionId}.cards` }
    }
    const cardTypes = session.cards.map((card) => isRecord(card) ? card.type : null)
    if (cardTypes.length !== expectedCardTypes.length || cardTypes.some((type, index) => type !== expectedCardTypes[index])) {
      return {
        bundle: null,
        error: `训练 ${sessionId} 必须按固定顺序包含六类卡片。`,
        errorPath: `sessions.${sessionId}.cards`,
      }
    }
  }
  return { bundle: value as EditableBundle, error: null, errorPath: null }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

export function semanticJson(value: unknown) {
  return JSON.stringify(stableValue(value))
}

export function cloneBundle(bundle: EditableBundle): EditableBundle {
  return structuredClone(bundle)
}

export function replaceAtPath(bundle: EditableBundle, path: Array<string | number>, value: unknown): EditableBundle {
  const next = cloneBundle(bundle)
  let target: any = next
  for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]!]
  target[path[path.length - 1]!] = value
  return next
}

export function moveItem<T>(items: T[], from: number, to: number) {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

function slugBase(value: string, fallback: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || fallback
}

export function uniqueId(existing: Iterable<string>, preferred: string, fallback: string) {
  const used = new Set(existing)
  const base = slugBase(preferred, fallback)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base}-${suffix++}`
  return candidate
}

export function validIdentifier(value: string) { return identifierPattern.test(value) }

export function createCatalog(bundle: EditableBundle, title = '新章节') {
  const next = cloneBundle(bundle)
  const id = uniqueId(Object.keys(next.catalogs), title, 'new-catalog')
  next.catalogs[id] = {
    schemaVersion: '1.0', catalogId: id, contentVersion: 1, title,
    skill: id, description: '请填写这个章节的学习目标和内容说明。', sessionIds: [],
  }
  next.library.catalogIds.push(id)
  return { bundle: next, id }
}

export function createSession(bundle: EditableBundle, catalogId: string, title = '新训练') {
  const next = cloneBundle(bundle)
  const catalog = next.catalogs[catalogId]
  if (!catalog) throw new Error('章节不存在')
  const id = uniqueId(Object.keys(next.sessions), title, 'new-session')
  next.sessions[id] = {
    schemaVersion: '1.0', sessionId: id, contentVersion: 1, title,
    objective: '请填写这组训练的学习目标。', skill: catalog.skill,
    difficulty: 'L1', riskLevel: 'low', estimatedMinutes: 3,
    cards: [
      { id: 'scenario', type: 'scenario', eyebrow: '情境练习', title: '请填写情境标题', context: '请用四十到一百二十个字描述一个匿名、低风险的职场沟通情境，交代关系、目标、限制和需要作出的决定。', question: '你会如何回应？' },
      { id: 'choice', type: 'choice', prompt: '选择一句更合适的表达', options: defaultOptions('choice') },
      { id: 'feedback', type: 'feedback', title: '不同表达会带来不同结果', comparisonLabel: '对比三种选择' },
      { id: 'principle', type: 'principle', title: '请填写核心原则', summary: '请概括这组训练的表达原则。', formula: '事实 + 影响 + 下一步', counterexample: '请填写一个反例。', example: '请填写一个符合原则的参考表达。' },
      { id: 'practice', type: 'practice', title: '换你来表达', prompt: '请结合当前情境写一句职场表达。', minLength: 10, maxLength: 200, dimensions: [{ id: 'clarity', title: '表达清晰', description: '关键信息完整且容易理解。', keywords: ['下一步'] }], referenceAnswer: '请填写一个结构完整的参考表达。', disclaimer: '结果仅供学习参考，请结合真实情况判断。' },
      { id: 'completion', type: 'completion', title: '完成训练', summary: '你已完成这组微训练。', takeaway: '带走一条可以立即使用的表达原则。' },
    ],
    reviewVariants: [],
  }
  catalog.sessionIds.push(id)
  return { bundle: next, id }
}

export function defaultOptions(prefix: string) {
  return [
    { id: `${prefix}-avoid`, text: '先等等看，也许问题会自己解决。', rating: 'not_recommended' as const, feedback: { interpretation: '对方可能认为你在回避问题。', strength: '暂时避免了直接冲突。', risk: '问题可能继续扩大且无人负责。' } },
    { id: `${prefix}-partial`, text: '现在可能有点困难，之后再说。', rating: 'risky' as const, feedback: { interpretation: '对方知道有问题，但不清楚影响。', strength: '已经开始表达限制。', risk: '没有明确事实和下一步。' } },
    { id: `${prefix}-recommended`, text: '这里出现了新限制，我建议先确认影响，再一起决定下一步。', rating: 'recommended' as const, feedback: { interpretation: '对方能理解现状、影响和请求。', strength: '信息完整并且给出了可执行的下一步。', risk: '如果时间要求很紧，还需要补充明确时间。' } },
  ]
}

export function renameCatalog(bundle: EditableBundle, currentId: string, nextId: string) {
  if (!validIdentifier(nextId)) throw new Error('ID 只能包含小写英文、数字和连字符')
  if (currentId !== nextId && bundle.catalogs[nextId]) throw new Error('章节 ID 已存在')
  const next = cloneBundle(bundle)
  const catalog = next.catalogs[currentId]
  if (!catalog) throw new Error('章节不存在')
  delete next.catalogs[currentId]
  catalog.catalogId = nextId
  next.catalogs[nextId] = catalog
  next.library.catalogIds = next.library.catalogIds.map((id) => id === currentId ? nextId : id)
  return next
}

export function renameSession(bundle: EditableBundle, currentId: string, nextId: string) {
  if (!validIdentifier(nextId)) throw new Error('ID 只能包含小写英文、数字和连字符')
  if (currentId !== nextId && bundle.sessions[nextId]) throw new Error('训练 ID 已存在')
  const next = cloneBundle(bundle)
  const session = next.sessions[currentId]
  if (!session) throw new Error('训练不存在')
  delete next.sessions[currentId]
  session.sessionId = nextId
  next.sessions[nextId] = session
  Object.values(next.catalogs).forEach((catalog) => { catalog.sessionIds = catalog.sessionIds.map((id) => id === currentId ? nextId : id) })
  return next
}

export function deleteCatalog(bundle: EditableBundle, catalogId: string) {
  const catalog = bundle.catalogs[catalogId]
  if (!catalog) throw new Error('章节不存在')
  if (catalog.sessionIds.length) throw new Error('请先移动或删除章节中的训练')
  if (bundle.library.catalogIds.length <= 1) throw new Error('不能删除最后一个章节')
  const next = cloneBundle(bundle)
  delete next.catalogs[catalogId]
  next.library.catalogIds = next.library.catalogIds.filter((id) => id !== catalogId)
  return next
}

export function deleteSession(bundle: EditableBundle, sessionId: string) {
  if (Object.keys(bundle.sessions).length <= 1) throw new Error('不能删除最后一组训练')
  const next = cloneBundle(bundle)
  delete next.sessions[sessionId]
  const emptiedCatalogs: string[] = []
  Object.values(next.catalogs).forEach((catalog) => {
    catalog.sessionIds = catalog.sessionIds.filter((id) => id !== sessionId)
    if (!catalog.sessionIds.length) emptiedCatalogs.push(catalog.catalogId)
  })
  emptiedCatalogs.forEach((catalogId) => {
    if (next.library.catalogIds.length <= 1) return
    delete next.catalogs[catalogId]
    next.library.catalogIds = next.library.catalogIds.filter((id) => id !== catalogId)
  })
  if (next.library.catalogIds.some((id) => !next.catalogs[id]?.sessionIds.length)) throw new Error('删除后会产生空章节，请先移动训练')
  return { bundle: next, removedCatalogIds: emptiedCatalogs.filter((id) => !next.catalogs[id]) }
}
