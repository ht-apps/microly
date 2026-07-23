import { trainingContent } from '../../data/training-content'
import { flushAnalyticsOutbox, trackEvent } from '../analytics/analytics-client'
import {
  initializeTrainingContentFromCache,
  refreshTrainingContent,
} from '../content/content-client'
import {
  flushCompletionOutbox,
  restoreServerCompletions,
} from '../sync/completion-sync'
import { flushFullSync } from '../sync/state-sync'

export function initializeLocalNetworkState() {
  initializeTrainingContentFromCache()
}

export async function bootstrapNetworkFeatures() {
  trackEvent('app_open', { source: 'direct' })
  await refreshTrainingContent()
  await flushCompletionOutbox()
  await restoreServerCompletions(trainingContent.sessions)
  await flushFullSync()
  await flushAnalyticsOutbox()
}
