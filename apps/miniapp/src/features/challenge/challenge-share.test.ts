import { describe, expect, it } from 'vitest'

import { createChallengeSharePayload } from './challenge-share'

describe('challenge share payload', () => {
  it('分享载荷只包含训练 ID、固定来源和品牌图', () => {
    const payload = createChallengeSharePayload({
      sessionId: 'boundary-decline-001',
      title: '拒绝临时任务',
    })

    expect(payload).toEqual({
      title: '如果是你，会怎么回应？｜拒绝临时任务',
      path: '/pages/challenge/index?sessionId=boundary-decline-001&source=challenge',
      imageUrl: '/assets/share/challenge-cover.png',
    })
    expect(payload.path).not.toMatch(/option|answer|practice|score/)
  })
})
