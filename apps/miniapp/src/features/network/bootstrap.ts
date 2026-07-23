import { trainingContent } from '../../data/training-content'
import { flushAnalyticsOutbox, trackEvent } from '../analytics/analytics-client'
import {
  initializeTrainingContentFromCache,
  refreshTrainingContent,
} from '../content/content-client'
import {
  backfillCompletionOutbox,
  flushCompletionOutbox,
  restoreServerCompletions,
} from '../sync/completion-sync'

export function initializeLocalNetworkState() {
  initializeTrainingContentFromCache()
}

export async function bootstrapNetworkFeatures() {
  trackEvent('app_open', { source: 'direct' })
  await refreshTrainingContent()
  backfillCompletionOutbox(trainingContent.sessions)
  await flushCompletionOutbox()
  await restoreServerCompletions(trainingContent.sessions)
  await flushAnalyticsOutbox()
}
