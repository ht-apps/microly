import { describe, expect, it } from 'vitest'

import {
  createCatalog, createSession, deleteSession, parseEditableBundle, renameCatalog,
  renameSession, replaceAtPath, semanticJson, type EditableBundle,
} from './content-workspace'

function baseBundle(): EditableBundle {
  return {
    releaseVersion: 1,
    library: { schemaVersion: '1.0', libraryId: 'test-library', contentVersion: 1, title: '测试课程', description: '这是一个用于测试的课程。', catalogIds: ['first-catalog'] },
    catalogs: { 'first-catalog': { schemaVersion: '1.0', catalogId: 'first-catalog', contentVersion: 1, title: '第一章', skill: 'first-skill', description: '用于测试的章节。', sessionIds: [] } },
    sessions: {},
  }
}

describe('content form workspace', () => {
  it('往返转换按语义比较并保留未知字段', () => {
    const source = { ...baseBundle(), extension: { enabled: true } } as EditableBundle
    const text = JSON.stringify(source, null, 4)
    const parsed = parseEditableBundle(text)
    expect(parsed.error).toBeNull()
    const changed = replaceAtPath(parsed.bundle!, ['library', 'title'], '新标题')
    expect((changed as any).extension).toEqual({ enabled: true })
    expect(semanticJson(JSON.parse(JSON.stringify(changed)))).toBe(semanticJson(changed))
  })

  it('拒绝语法错误和不可识别的内容结构', () => {
    expect(parseEditableBundle('{').bundle).toBeNull()
    expect(parseEditableBundle('{"library":{},"catalogs":{},"sessions":{"bad":{}}}').error).toContain('cards')
    const created = createSession(baseBundle(), 'first-catalog', '训练').bundle
    created.sessions[Object.keys(created.sessions)[0]!]!.cards.pop()
    const malformed = parseEditableBundle(JSON.stringify(created))
    expect(malformed.error).toContain('固定顺序')
    expect(malformed.errorPath).toContain('.cards')
  })

  it('新建章节和训练时生成完整六卡片模板', () => {
    const catalog = createCatalog(baseBundle(), '新章节')
    expect(catalog.bundle.library.catalogIds).toContain(catalog.id)
    const session = createSession(catalog.bundle, catalog.id, '新训练')
    expect(session.bundle.sessions[session.id]?.cards.map((card) => card.type)).toEqual(['scenario', 'choice', 'feedback', 'principle', 'practice', 'completion'])
    expect(session.bundle.catalogs[catalog.id]?.sessionIds).toContain(session.id)
  })

  it('受控重命名同步更新对象键和所有引用', () => {
    const created = createSession(baseBundle(), 'first-catalog', '训练')
    const renamedCatalog = renameCatalog(created.bundle, 'first-catalog', 'renamed-catalog')
    expect(renamedCatalog.library.catalogIds).toEqual(['renamed-catalog'])
    expect(renamedCatalog.catalogs['renamed-catalog']?.catalogId).toBe('renamed-catalog')
    const renamedSession = renameSession(renamedCatalog, created.id, 'renamed-session')
    expect(renamedSession.catalogs['renamed-catalog']?.sessionIds).toEqual(['renamed-session'])
    expect(renamedSession.sessions['renamed-session']?.sessionId).toBe('renamed-session')
  })

  it('删除训练时清理引用并阻止删除最后一组', () => {
    const first = createSession(baseBundle(), 'first-catalog', '第一组')
    const second = createSession(first.bundle, 'first-catalog', '第二组')
    const deleted = deleteSession(second.bundle, first.id)
    expect(deleted.bundle.sessions[first.id]).toBeUndefined()
    expect(deleted.bundle.catalogs['first-catalog']?.sessionIds).toEqual([second.id])
    expect(() => deleteSession(deleted.bundle, second.id)).toThrow('最后一组')
  })
})
