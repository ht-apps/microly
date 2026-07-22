import { describe, expect, it } from 'vitest'

import { getTrainingSession } from '../../data/training-content'
import {
  createInitialProgress,
  parseTrainingProgress,
  transitionTraining,
} from './training-state'

const firstTrainingSession = getTrainingSession('boundary-decline-001')

if (!firstTrainingSession) {
  throw new Error('测试训练内容应当通过 Schema 校验')
}

const session = firstTrainingSession
const timestamp = '2026-07-22T12:00:00.000Z'

function reachChoice() {
  const initial = createInitialProgress(session, timestamp)
  const started = transitionTraining(initial, session, { type: 'START' }, timestamp)
  return transitionTraining(started, session, { type: 'NEXT' }, timestamp)
}

function reachPractice() {
  let progress = reachChoice()
  progress = transitionTraining(progress, session, {
    type: 'SELECT_OPTION',
    optionId: 'constructive-boundary',
  }, timestamp)
  progress = transitionTraining(progress, session, { type: 'CONFIRM_CHOICE' }, timestamp)
  progress = transitionTraining(progress, session, { type: 'NEXT' }, timestamp)
  progress = transitionTraining(progress, session, { type: 'NEXT' }, timestamp)
  return transitionTraining(progress, session, { type: 'NEXT' }, timestamp)
}

describe('training state', () => {
  it('开始后进入进行中状态并到达选择卡', () => {
    const progress = reachChoice()

    expect(progress.status).toBe('in_progress')
    expect(progress.currentCardIndex).toBe(1)
  })

  it('未开始时不能绕过开始动作直接前进', () => {
    const initial = createInitialProgress(session, timestamp)
    const blocked = transitionTraining(initial, session, { type: 'NEXT' }, timestamp)

    expect(blocked.currentCardIndex).toBe(0)
    expect(blocked.status).toBe('not_started')
  })

  it('确认选择前不能前进，确认后直接进入反馈且不能改选项', () => {
    const choice = reachChoice()
    const blocked = transitionTraining(choice, session, { type: 'NEXT' }, timestamp)
    const selected = transitionTraining(choice, session, {
      type: 'SELECT_OPTION',
      optionId: 'direct-refusal',
    }, timestamp)
    const confirmed = transitionTraining(selected, session, {
      type: 'CONFIRM_CHOICE',
    }, timestamp)
    const changed = transitionTraining(confirmed, session, {
      type: 'SELECT_OPTION',
      optionId: 'constructive-boundary',
    }, timestamp)

    expect(blocked.currentCardIndex).toBe(1)
    expect(confirmed.choiceConfirmed).toBe(true)
    expect(confirmed.currentCardIndex).toBe(2)
    expect(changed.selectedOptionId).toBe('direct-refusal')
  })

  it('反馈页可以展开和收起其他选项', () => {
    let progress = reachChoice()
    progress = transitionTraining(progress, session, {
      type: 'SELECT_OPTION',
      optionId: 'constructive-boundary',
    }, timestamp)
    progress = transitionTraining(progress, session, { type: 'CONFIRM_CHOICE' }, timestamp)
    const expanded = transitionTraining(progress, session, {
      type: 'TOGGLE_OTHER_FEEDBACK',
    }, timestamp)
    const collapsed = transitionTraining(expanded, session, {
      type: 'TOGGLE_OTHER_FEEDBACK',
    }, timestamp)

    expect(expanded.otherFeedbackExpanded).toBe(true)
    expect(collapsed.otherFeedbackExpanded).toBe(false)
  })

  it('不足最小字数时不能提交，完成检查后可以完成训练', () => {
    let progress = reachPractice()
    progress = transitionTraining(progress, session, {
      type: 'UPDATE_PRACTICE',
      text: '太短了',
    }, timestamp)
    const blocked = transitionTraining(progress, session, {
      type: 'SUBMIT_PRACTICE',
    }, timestamp)

    expect(blocked.practiceEvaluation).toBeNull()

    progress = transitionTraining(progress, session, {
      type: 'UPDATE_PRACTICE',
      text: '我今天无法全部完成，可以先做关键部分，其余明早补齐。',
    }, timestamp)
    progress = transitionTraining(progress, session, {
      type: 'SUBMIT_PRACTICE',
    }, timestamp)
    const completed = transitionTraining(progress, session, {
      type: 'COMPLETE',
    }, timestamp)

    expect(progress.practiceEvaluation).toHaveLength(3)
    expect(completed.status).toBe('completed')
    expect(completed.currentCardIndex).toBe(session.cards.length - 1)
  })

  it('重新训练会恢复初始状态', () => {
    const progress = reachChoice()
    const reset = transitionTraining(progress, session, { type: 'RESET' }, timestamp)

    expect(reset).toEqual(createInitialProgress(session, timestamp))
  })
})

describe('parseTrainingProgress', () => {
  it('恢复合法的中断进度', () => {
    const progress = reachChoice()
    const parsed = parseTrainingProgress(progress, session)

    expect(parsed.recoveredFromInvalid).toBe(false)
    expect(parsed.progress.currentCardIndex).toBe(1)
  })

  it('将旧版已确认的选择卡进度迁移到反馈页', () => {
    let progress = reachChoice()
    progress = transitionTraining(progress, session, {
      type: 'SELECT_OPTION',
      optionId: 'constructive-boundary',
    }, timestamp)

    const parsed = parseTrainingProgress({
      ...progress,
      choiceConfirmed: true,
    }, session)

    expect(parsed.recoveredFromInvalid).toBe(false)
    expect(parsed.progress.currentCardIndex).toBe(2)
  })

  it('损坏数据和旧内容版本会安全重置', () => {
    const corrupted = parseTrainingProgress({ status: 'in_progress' }, session)
    const oldVersion = parseTrainingProgress({
      ...reachChoice(),
      contentVersion: session.contentVersion - 1,
    }, session)

    expect(corrupted.recoveredFromInvalid).toBe(true)
    expect(corrupted.progress.status).toBe('not_started')
    expect(oldVersion.recoveredFromInvalid).toBe(true)
  })
})
