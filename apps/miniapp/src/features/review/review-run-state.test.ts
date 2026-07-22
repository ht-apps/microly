import { describe, expect, it } from 'vitest'

import { createReviewRunState, transitionReviewRun } from './review-run-state'

describe('review run state', () => {
  it('确认前可以改选，确认后锁定选项', () => {
    let state = transitionReviewRun(
      createReviewRunState(),
      { type: 'START', itemCount: 2 },
    )
    state = transitionReviewRun(state, { type: 'SELECT', optionId: 'option-a' })
    state = transitionReviewRun(state, { type: 'SELECT', optionId: 'option-b' })
    state = transitionReviewRun(state, { type: 'CONFIRM', isCorrect: false })
    const locked = transitionReviewRun(
      state,
      { type: 'SELECT', optionId: 'option-c' },
    )

    expect(locked.selectedOptionId).toBe('option-b')
    expect(locked.answerConfirmed).toBe(true)
  })

  it('只有确认答案后才能进入下一题并累计正确数', () => {
    let state = transitionReviewRun(
      createReviewRunState(),
      { type: 'START', itemCount: 2 },
    )
    expect(transitionReviewRun(state, { type: 'NEXT' })).toEqual(state)

    state = transitionReviewRun(state, { type: 'SELECT', optionId: 'recommended' })
    state = transitionReviewRun(state, { type: 'CONFIRM', isCorrect: true })
    state = transitionReviewRun(state, { type: 'NEXT' })

    expect(state.currentIndex).toBe(1)
    expect(state.correctCount).toBe(1)
    expect(state.selectedOptionId).toBeNull()
  })

  it('最后一题确认后完成复习', () => {
    let state = transitionReviewRun(
      createReviewRunState(),
      { type: 'START', itemCount: 1 },
    )
    state = transitionReviewRun(state, { type: 'SELECT', optionId: 'recommended' })
    state = transitionReviewRun(state, { type: 'CONFIRM', isCorrect: true })
    state = transitionReviewRun(state, { type: 'NEXT' })

    expect(state.completed).toBe(true)
    expect(state.correctCount).toBe(1)
  })
})
