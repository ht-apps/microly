import { describe, expect, it } from 'vitest'

import catalog from './boundary-catalog.json'
import deadline from './boundary-deadline-003.json'
import decline from './boundary-decline-001.json'
import priority from './boundary-priority-002.json'
import { loadTrainingContent } from './training-content'

const sessionInputs: Record<string, unknown> = {
  'boundary-decline-001': decline,
  'boundary-priority-002': priority,
  'boundary-deadline-003': deadline,
}

describe('training content repository', () => {
  it('按目录顺序加载三组合法训练', () => {
    const repository = loadTrainingContent(catalog, sessionInputs)

    expect(repository.catalog?.catalogId).toBe('boundary-communication')
    expect(repository.sessions.map((session) => session.sessionId)).toEqual(
      catalog.sessionIds,
    )
    expect(repository.errors).toEqual([])
  })

  it('隔离单组损坏内容并继续提供其他训练', () => {
    const repository = loadTrainingContent(catalog, {
      ...sessionInputs,
      'boundary-priority-002': { invalid: true },
    })

    expect(repository.sessions.map((session) => session.sessionId)).toEqual([
      'boundary-decline-001',
      'boundary-deadline-003',
    ])
    expect(repository.entries[1].session).toBeNull()
    expect(repository.errors[0].sessionId).toBe('boundary-priority-002')
  })

  it('目录损坏时不加载未经目录校验的训练', () => {
    const repository = loadTrainingContent({
      ...catalog,
      sessionIds: [],
    }, sessionInputs)

    expect(repository.catalog).toBeNull()
    expect(repository.sessions).toEqual([])
    expect(repository.errors).toHaveLength(1)
  })

  it('全部训练损坏时保留错误但不提供可用训练', () => {
    const repository = loadTrainingContent(catalog, {})

    expect(repository.catalog).not.toBeNull()
    expect(repository.sessions).toEqual([])
    expect(repository.errors).toHaveLength(3)
  })

  it('拒绝目录引用与内容 ID 不一致的训练', () => {
    const repository = loadTrainingContent(catalog, {
      ...sessionInputs,
      'boundary-priority-002': {
        ...priority,
        sessionId: 'boundary-other-002',
      },
    })

    expect(repository.entries[1].session).toBeNull()
    expect(repository.entries[1].error).toBe('训练内容 ID 与目录不一致')
  })
})
