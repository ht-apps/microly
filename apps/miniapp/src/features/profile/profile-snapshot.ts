import { trainingContent } from '../../data/training-content'
import { createLearningActivitySummary } from '../activity/activity-state'
import { syncLearningActivity } from '../activity/activity-storage'
import { syncFavoriteQueue } from '../favorite/favorite-storage'
import { readPreferenceSnapshot } from '../preference/preference-snapshot'
import { readReviewSnapshot } from '../review/review-snapshot'
import { createCourseOverview } from '../training/training-scheduler'
import { readAllTrainingProgress } from '../training/training-storage'
import { createProfileSummary } from './profile-summary'

export function readProfileSnapshot(now?: string) {
  const training = readAllTrainingProgress(trainingContent.sessions)
  const course = createCourseOverview(
    trainingContent.chapters,
    training.progressBySessionId,
  )
  const reviews = readReviewSnapshot(now)
  const favorites = syncFavoriteQueue(trainingContent.sessions)
  const activity = syncLearningActivity(
    trainingContent.sessions,
    training.progressBySessionId,
  )
  const activitySummary = createLearningActivitySummary(activity.events, now)
  const preference = readPreferenceSnapshot()

  return {
    summary: createProfileSummary({
      completedCount: course.completedCount,
      availableCount: course.availableCount,
      dueReviewCount: reviews.overview.dueItems.length,
      favoriteCount: favorites.resolvedItems.length,
      currentStreak: activitySummary.currentStreak,
      weekEffectiveDayCount: activitySummary.weekEffectiveDayCount,
    }),
    nextReviewAt: reviews.overview.nextDueAt,
    preferenceSummary: preference.summary,
    recoveredFromInvalid:
      training.recoveredSessionIds.length > 0
      || reviews.recoveredFromInvalid
      || reviews.trainingProgressRecovered
      || favorites.recoveredFromInvalid
      || activity.recoveredFromInvalid
      || preference.recoveredFromInvalid,
    writeFailed:
      reviews.writeFailed
      || favorites.writeFailed
      || activity.writeFailed
      || preference.writeFailed,
  }
}
