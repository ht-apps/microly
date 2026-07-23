export interface ProfileSummary {
  completedCount: number
  availableCount: number
  completionPercent: number
  dueReviewCount: number
  favoriteCount: number
  currentStreak: number
  weekEffectiveDayCount: number
}

export function createProfileSummary(input: {
  completedCount: number
  availableCount: number
  dueReviewCount: number
  favoriteCount: number
  currentStreak: number
  weekEffectiveDayCount: number
}): ProfileSummary {
  const completionPercent = input.availableCount > 0
    ? Math.round((input.completedCount / input.availableCount) * 100)
    : 0

  return {
    ...input,
    completionPercent,
  }
}
