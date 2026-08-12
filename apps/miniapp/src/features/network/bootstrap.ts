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
import { flushClientErrors } from '../diagnostics/client-errors'
import { installUpdateManager, refreshRuntimeConfig } from './runtime-config'

export function initializeLocalNetworkState() {
  initializeTrainingContentFromCache()
  installUpdateManager()
}

export async function bootstrapNetworkFeatures() {
  trackEvent('app_open', { source: 'direct' })
  await refreshRuntimeConfig()
  await flushClientErrors()
  await refreshTrainingContent()
  await flushCompletionOutbox()
  await restoreServerCompletions(trainingContent.sessions)
  await flushFullSync()
  await flushAnalyticsOutbox()
}
