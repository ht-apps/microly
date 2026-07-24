import { describe, expect, it } from 'vitest'

import actionCatalog from './data/action-catalog.json'
import actionFollowup from './data/action-followup-009.json'
import actionOwner from './data/action-owner-010.json'
import boundaryCatalog from './data/boundary-catalog.json'
import deadline from './data/boundary-deadline-003.json'
import decline from './data/boundary-decline-001.json'
import priority from './data/boundary-priority-002.json'
import disagreementCatalog from './data/disagreement-catalog.json'
import disagreeAlternative from './data/disagree-alternative-008.json'
import disagreeGoal from './data/disagree-goal-007.json'
import reportingCatalog from './data/reporting-catalog.json'
import reportConclusion from './data/report-conclusion-004.json'
import reportRisk from './data/report-risk-005.json'
import reportSupport from './data/report-support-006.json'
import library from './data/training-library.json'
import { loadTrainingContent, remoteTrainingContentBundle, trainingContentBundle } from './index'

const catalogInputs: Record<string, unknown> = {
  'boundary-communication': boundaryCatalog,
  'clear-reporting': reportingCatalog,
  'constructive-disagreement': disagreementCatalog,
  'action-alignment': actionCatalog,
}

const sessionInputs: Record<string, unknown> = {
  'boundary-decline-001': decline,
  'boundary-priority-002': priority,
  'boundary-deadline-003': deadline,
  'report-conclusion-004': reportConclusion,
  'report-risk-005': reportRisk,
  'report-support-006': reportSupport,
  'disagree-goal-007': disagreeGoal,
  'disagree-alternative-008': disagreeAlternative,
  'action-followup-009': actionFollowup,
  'action-owner-010': actionOwner,
}

describe('training content repository', () => {
  it('远程封测内容为 30 组，离线兜底仍保持原有 10 组', () => {
    expect(Object.keys(trainingContentBundle.sessions)).toHaveLength(10)
    expect(Object.keys(remoteTrainingContentBundle.sessions)).toHaveLength(30)
    expect(remoteTrainingContentBundle.library.catalogIds.map((catalogId) => remoteTrainingContentBundle.catalogs[catalogId]!.sessionIds.length)).toEqual([8, 8, 7, 7])
    Object.values(remoteTrainingContentBundle.sessions).forEach((session) => {
      expect(session.cards.map((card) => card.type)).toEqual(['scenario', 'choice', 'feedback', 'principle', 'practice', 'completion'])
      expect(session.cards.find((card) => card.type === 'choice')?.options.filter((option) => option.rating === 'recommended')).toHaveLength(1)
      expect(session.reviewVariants).toHaveLength(2)
    })
  })

  it('按课程库顺序加载四章十组合法训练', () => {
    const repository = loadTrainingContent(library, catalogInputs, sessionInputs)

    expect(repository.library?.libraryId).toBe('workplace-communication-foundations')
    expect(repository.chapters.map((chapter) => chapter.catalogId)).toEqual(library.catalogIds)
    expect(repository.sessions).toHaveLength(10)
    expect(repository.sessions.map((session) => session.sessionId)).toEqual([
      ...boundaryCatalog.sessionIds,
      ...reportingCatalog.sessionIds,
      ...disagreementCatalog.sessionIds,
      ...actionCatalog.sessionIds,
    ])
    expect(repository.errors).toEqual([])
  })

  it('十组内容均包含完整评级与三个主动表达维度', () => {
    const repository = loadTrainingContent(library, catalogInputs, sessionInputs)

    repository.sessions.forEach((session) => {
      const choice = session.cards.find((card) => card.type === 'choice')
      const practice = session.cards.find((card) => card.type === 'practice')
      expect(choice?.options.map((option) => option.rating).sort()).toEqual([
        'not_recommended',
        'recommended',
        'risky',
      ])
      expect(practice?.dimensions).toHaveLength(3)
    })
  })

  it('隔离单组损坏内容并继续提供其他训练', () => {
    const repository = loadTrainingContent(library, catalogInputs, {
      ...sessionInputs,
      'report-risk-005': { invalid: true },
    })

    expect(repository.sessions).toHaveLength(9)
    expect(repository.entries.find(
      (entry) => entry.sessionId === 'report-risk-005',
    )?.session).toBeNull()
    expect(repository.errors[0]).toMatchObject({
      scope: 'session',
      contentId: 'report-risk-005',
    })
  })

  it('隔离单章损坏目录并继续加载后续章节', () => {
    const repository = loadTrainingContent(library, {
      ...catalogInputs,
      'clear-reporting': { invalid: true },
    }, sessionInputs)

    expect(repository.chapters[1].catalog).toBeNull()
    expect(repository.sessions).toHaveLength(7)
    expect(repository.sessions.some(
      (session) => session.sessionId === 'disagree-goal-007',
    )).toBe(true)
  })

  it('课程库损坏时不加载未经目录校验的内容', () => {
    const repository = loadTrainingContent({ ...library, catalogIds: [] }, catalogInputs, sessionInputs)

    expect(repository.library).toBeNull()
    expect(repository.sessions).toEqual([])
    expect(repository.errors).toHaveLength(1)
  })

  it('拒绝目录、技能或内容 ID 不一致的训练', () => {
    const repository = loadTrainingContent(library, {
      ...catalogInputs,
      'clear-reporting': { ...reportingCatalog, catalogId: 'other-reporting' },
    }, {
      ...sessionInputs,
      'boundary-priority-002': { ...priority, sessionId: 'boundary-other-002' },
      'disagree-goal-007': { ...disagreeGoal, skill: 'other-skill' },
    })

    expect(repository.chapters[1].catalog).toBeNull()
    expect(repository.entries.find(
      (entry) => entry.sessionId === 'boundary-priority-002',
    )?.error).toBe('训练内容 ID 与目录不一致')
    expect(repository.entries.find(
      (entry) => entry.sessionId === 'disagree-goal-007',
    )?.error).toBe('训练内容技能与章节不一致')
  })

  it('拒绝跨章节重复训练 ID', () => {
    const repository = loadTrainingContent(library, {
      ...catalogInputs,
      'clear-reporting': {
        ...reportingCatalog,
        sessionIds: ['boundary-decline-001', ...reportingCatalog.sessionIds.slice(1)],
      },
    }, sessionInputs)

    const duplicated = repository.chapters[1].entries[0]
    expect(duplicated.session).toBeNull()
    expect(duplicated.error).toBe('训练 ID 在多个章节中重复')
  })
})
