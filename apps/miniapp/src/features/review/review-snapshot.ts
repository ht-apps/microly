import { trainingContent } from '../../data/training-content'
import { createReviewOverview } from './review-state'
import { syncReviewQueue } from './review-storage'

export function readReviewSnapshot(now?: string) {
  const reviewQueue = syncReviewQueue(trainingContent.sessions)

  return {
    overview: createReviewOverview(
      reviewQueue.items,
      trainingContent.sessions,
      now,
    ),
    recoveredFromInvalid:
      reviewQueue.recoveredFromInvalid,
    writeFailed: reviewQueue.writeFailed,
  }
}
