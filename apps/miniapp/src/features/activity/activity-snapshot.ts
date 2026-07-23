import { trainingContent } from '../../data/training-content'
import { readAllTrainingProgress } from '../training/training-storage'
import { createLearningActivitySummary } from './activity-state'
import { syncLearningActivity } from './activity-storage'

export function readLearningActivitySnapshot(now?: string) {
  const training = readAllTrainingProgress(trainingContent.sessions)
  const activity = syncLearningActivity(
    trainingContent.sessions,
    training.progressBySessionId,
  )

  return {
    summary: createLearningActivitySummary(activity.events, now),
    events: activity.events,
    recoveredFromInvalid:
      training.recoveredSessionIds.length > 0 || activity.recoveredFromInvalid,
    writeFailed: activity.writeFailed,
  }
}
