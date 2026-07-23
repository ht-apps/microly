import { trainingContent } from '../../data/training-content'
import { createLearningActivitySummary } from './activity-state'
import { syncLearningActivity } from './activity-storage'

export function readLearningActivitySnapshot(now?: string) {
  const activity = syncLearningActivity(trainingContent.sessions)

  return {
    summary: createLearningActivitySummary(activity.events, now),
    events: activity.events,
    recoveredFromInvalid: activity.recoveredFromInvalid,
    writeFailed: activity.writeFailed,
  }
}
