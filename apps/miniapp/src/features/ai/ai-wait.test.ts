import { describe, expect, it } from 'vitest'

import { AI_FOREGROUND_WAIT_MS, remainingAiWaitSeconds } from './ai-wait'

describe('remainingAiWaitSeconds', () => {
  it('starts with the full foreground wait', () => {
    expect(remainingAiWaitSeconds(AI_FOREGROUND_WAIT_MS, 0)).toBe(8)
  })

  it('rounds up so the completion button is not unlocked early', () => {
    expect(remainingAiWaitSeconds(8000, 7001)).toBe(1)
  })

  it('unlocks at the deadline and remains unlocked afterwards', () => {
    expect(remainingAiWaitSeconds(8000, 8000)).toBe(0)
    expect(remainingAiWaitSeconds(8000, 9000)).toBe(0)
    expect(remainingAiWaitSeconds(null, 0)).toBe(0)
  })
})
