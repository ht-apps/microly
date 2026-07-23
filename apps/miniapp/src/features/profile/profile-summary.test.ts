import { describe, expect, it } from 'vitest'

import { createProfileSummary } from './profile-summary'

describe('profile summary', () => {
  it('生成空数据摘要', () => {
    expect(createProfileSummary({
      completedCount: 0,
      availableCount: 0,
      dueReviewCount: 0,
      favoriteCount: 0,
      currentStreak: 0,
      weekEffectiveDayCount: 0,
    })).toEqual({
      completedCount: 0,
      availableCount: 0,
      completionPercent: 0,
      dueReviewCount: 0,
      favoriteCount: 0,
      currentStreak: 0,
      weekEffectiveDayCount: 0,
    })
  })

  it('计算部分完成和全部完成进度', () => {
    expect(createProfileSummary({
      completedCount: 1,
      availableCount: 3,
      dueReviewCount: 2,
      favoriteCount: 1,
      currentStreak: 2,
      weekEffectiveDayCount: 3,
    })).toMatchObject({
      completionPercent: 33,
      dueReviewCount: 2,
      favoriteCount: 1,
      currentStreak: 2,
      weekEffectiveDayCount: 3,
    })

    expect(createProfileSummary({
      completedCount: 3,
      availableCount: 3,
      dueReviewCount: 0,
      favoriteCount: 3,
      currentStreak: 7,
      weekEffectiveDayCount: 7,
    }).completionPercent).toBe(100)
  })
})
