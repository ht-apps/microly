import { describe, expect, it } from 'vitest'

import { AI_EVAL_SAMPLES } from './fixtures.js'

describe('AI 离线评测集', () => {
  it('包含 10 组训练和至少 100 条合成样本', () => {
    expect(AI_EVAL_SAMPLES).toHaveLength(100)
    expect(new Set(AI_EVAL_SAMPLES.map((sample) => sample.sessionId)).size).toBe(10)
    expect(AI_EVAL_SAMPLES.every((sample) => sample.text.length >= 10 && sample.text.length <= 200)).toBe(true)
  })
})
