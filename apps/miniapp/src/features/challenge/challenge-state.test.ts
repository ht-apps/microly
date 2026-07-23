import { describe, expect, it } from 'vitest'

import { getTrainingSession, trainingContent } from '../../data/training-content'
import { createCourseOverview } from '../training/course-overview'
import { createInitialProgress } from '../training/training-state'
import {
  createChallengeState,
  resolveChallengeContent,
  selectChallengeContinuation,
  transitionChallenge,
} from './challenge-state'

const session = getTrainingSession('boundary-decline-001')
if (!session) throw new Error('缺少挑战测试训练内容')
const content = resolveChallengeContent(session)
if (!content) throw new Error('挑战测试内容不完整')

describe('challenge state', () => {
  it('确认前可以改选，确认后锁定', () => {
    const firstOption = content.choiceCard.options[0]
    const secondOption = content.choiceCard.options[1]
    let state = createChallengeState()
    state = transitionChallenge(state, {
      type: 'SELECT',
      optionId: firstOption.id,
    }, content.choiceCard)
    state = transitionChallenge(state, {
      type: 'SELECT',
      optionId: secondOption.id,
    }, content.choiceCard)
    state = transitionChallenge(state, { type: 'CONFIRM' }, content.choiceCard)
    const locked = transitionChallenge(state, {
      type: 'SELECT',
      optionId: firstOption.id,
    }, content.choiceCard)

    expect(state).toEqual({
      selectedOptionId: secondOption.id,
      answerConfirmed: true,
    })
    expect(locked).toBe(state)
  })

  it('无选择和未知选项不能确认', () => {
    const initial = createChallengeState()
    expect(transitionChallenge(
      initial,
      { type: 'CONFIRM' },
      content.choiceCard,
    )).toBe(initial)
    expect(transitionChallenge(
      initial,
      { type: 'SELECT', optionId: 'unknown' },
      content.choiceCard,
    )).toBe(initial)
  })

  it('挑战内容包含三种评级和推荐表达', () => {
    expect(content.choiceCard.options.map((option) => option.rating).sort()).toEqual([
      'not_recommended',
      'recommended',
      'risky',
    ])
    expect(content.recommendedOption.rating).toBe('recommended')
  })

  it('未知训练不会被内容仓库解析', () => {
    expect(getTrainingSession('unknown-challenge')).toBeNull()
  })

  it('全新用户从首组开始，已有用户恢复当前训练', () => {
    const progressBySessionId = Object.fromEntries(
      trainingContent.sessions.map((item) => [
        item.sessionId,
        createInitialProgress(item, '2026-07-23T08:00:00.000Z'),
      ]),
    )
    const freshOverview = createCourseOverview(
      trainingContent.chapters,
      progressBySessionId,
    )
    expect(selectChallengeContinuation(freshOverview, false)).toEqual({
      type: 'training',
      sessionId: trainingContent.sessions[0].sessionId,
      label: '从第一组开始',
    })

    progressBySessionId[trainingContent.sessions[0].sessionId] = {
      ...progressBySessionId[trainingContent.sessions[0].sessionId],
      status: 'completed',
      currentCardIndex: trainingContent.sessions[0].cards.length - 1,
      completedAt: '2026-07-23T08:00:00.000Z',
    }
    const existingOverview = createCourseOverview(
      trainingContent.chapters,
      progressBySessionId,
    )
    expect(selectChallengeContinuation(existingOverview, true)).toEqual({
      type: 'training',
      sessionId: trainingContent.sessions[1].sessionId,
      label: '继续我的训练',
    })
  })

  it('全课程完成后进入课程页', () => {
    const progressBySessionId = Object.fromEntries(
      trainingContent.sessions.map((item) => [
        item.sessionId,
        {
          ...createInitialProgress(item, '2026-07-23T08:00:00.000Z'),
          status: 'completed' as const,
          currentCardIndex: item.cards.length - 1,
          completedAt: '2026-07-23T08:00:00.000Z',
        },
      ]),
    )
    const overview = createCourseOverview(
      trainingContent.chapters,
      progressBySessionId,
    )
    expect(selectChallengeContinuation(overview, true)).toEqual({
      type: 'course',
      label: '查看已完成课程',
    })
  })
})
