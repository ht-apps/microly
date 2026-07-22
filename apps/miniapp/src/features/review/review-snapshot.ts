import { trainingContent } from '../../data/training-content'
import { readAllTrainingProgress } from '../training/training-storage'
import { createReviewOverview } from './review-state'
import { syncReviewQueueFromProgress } from './review-storage'

export function readReviewSnapshot(now?: string) {
  const trainingProgress = readAllTrainingProgress(trainingContent.sessions)
  const reviewQueue = syncReviewQueueFromProgress(
    trainingContent.sessions,
    trainingProgress.progressBySessionId,
  )

  return {
    overview: createReviewOverview(
      reviewQueue.items,
      trainingContent.sessions,
      now,
    ),
    recoveredFromInvalid:
      reviewQueue.recoveredFromInvalid,
    trainingProgressRecovered:
      trainingProgress.recoveredSessionIds.length > 0,
    writeFailed: reviewQueue.writeFailed,
  }
}
