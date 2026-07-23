import {
  SyncResponseSchema,
  type FavoriteSyncRecord,
  type SyncRequest,
  type SyncSnapshot,
  type TrainingProgressSyncRecord,
} from '@microly/api-contract'
import Taro from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { readLearningActivity, writeLearningActivity } from '../activity/activity-storage'
import { readFavoriteQueue, readFavoriteSyncRecords, writeFavoriteQueue, writeFavoriteSyncRecords } from '../favorite/favorite-storage'
import { authorizedRequest } from '../network/guest-auth'
import { readUserPreference, writeUserPreference } from '../preference/preference-storage'
import { readReviewQueue, writeReviewQueue } from '../review/review-storage'
import { createSecureUuid } from '../network/identifier'
import { readAllTrainingProgress, readTrainingProgress, writeTrainingProgress } from '../training/training-storage'
import { clearFullSyncPending } from './sync-pending'
import { trackEvent } from '../analytics/analytics-client'

export const LAST_SYNC_STORAGE_KEY = 'microly:sync:last-success:v1'
const SYNC_REQUEST_ID_KEY = 'microly:sync:request-id:v1'
const SYNC_RETRY_KEY = 'microly:sync:retry:v1'

function favoriteRecords(): FavoriteSyncRecord[] {
  const explicit = readFavoriteSyncRecords()
  const byId = new Map(explicit.map((item) => [item.favoriteId, item]))
  readFavoriteQueue(trainingContent.sessions).items.forEach((item) => {
    if (!byId.has(item.favoriteId)) byId.set(item.favoriteId, {
      ...item, active: true, updatedAt: item.createdAt,
    })
  })
  return [...byId.values()]
}

function progressRecord(progress: ReturnType<typeof readTrainingProgress>['progress']): TrainingProgressSyncRecord {
  return {
    sessionId: progress.sessionId,
    contentVersion: progress.contentVersion,
    attemptId: progress.attemptId,
    status: progress.status,
    currentCardIndex: progress.currentCardIndex,
    selectedOptionId: progress.selectedOptionId,
    choiceConfirmed: progress.choiceConfirmed,
    startedAt: progress.startedAt,
    updatedAt: progress.updatedAt,
    completedAt: progress.completedAt,
  }
}

async function requestId() {
  const stored = Taro.getStorageSync<unknown>(SYNC_REQUEST_ID_KEY)
  if (typeof stored === 'string' && stored.length > 0) return stored
  const next = await createSecureUuid()
  Taro.setStorageSync(SYNC_REQUEST_ID_KEY, next)
  return next
}

export async function createLocalSyncRequest(): Promise<SyncRequest> {
  const preference = readUserPreference(trainingContent.library?.catalogIds ?? []).preference
  const progress = readAllTrainingProgress(trainingContent.sessions).progressBySessionId
  return {
    requestId: await requestId(),
    preference,
    favorites: favoriteRecords(),
    reviews: readReviewQueue(trainingContent.sessions).items,
    progress: Object.values(progress).filter((item) => item.status !== 'not_started').map(progressRecord),
    activities: readLearningActivity(trainingContent.sessions).events,
  }
}

export function applySyncSnapshot(value: SyncSnapshot) {
  if (value.preference) writeUserPreference(value.preference)
  const activeFavorites = value.favorites.filter((item) => item.active).map((item) => ({
    favoriteId: item.favoriteId,
    sessionId: item.sessionId,
    contentVersion: item.contentVersion,
    cardId: item.cardId,
    createdAt: item.createdAt,
  }))
  writeFavoriteQueue(activeFavorites)
  writeFavoriteSyncRecords(value.favorites)
  writeReviewQueue(value.reviews)
  writeLearningActivity(value.activities)
  const sessions = new Map(trainingContent.sessions.map((session) => [session.sessionId, session]))
  value.progress.forEach((remote) => {
    const session = sessions.get(remote.sessionId)
    if (!session || session.contentVersion !== remote.contentVersion) return
    const local = readTrainingProgress(session).progress
    writeTrainingProgress({
      ...local,
      ...remote,
      otherFeedbackExpanded: local.otherFeedbackExpanded,
      practiceText: local.practiceText,
      practiceEvaluation: remote.status === 'completed'
        ? local.practiceEvaluation ?? []
        : local.practiceEvaluation,
    })
  })
  Taro.setStorageSync(LAST_SYNC_STORAGE_KEY, value.serverTime)
}

export async function flushFullSync(force = false) {
  try {
    const retry = Taro.getStorageSync<{ attempts?: number; nextAttemptAt?: number }>(SYNC_RETRY_KEY)
    if (!force && retry?.nextAttemptAt && retry.nextAttemptAt > Date.now()) return false
    const response = await authorizedRequest<unknown>({ path: '/v1/sync', method: 'POST', data: await createLocalSyncRequest() })
    const parsed = SyncResponseSchema.safeParse(response?.data)
    if (!response || response.statusCode !== 200 || !parsed.success) throw new Error('Sync failed')
    applySyncSnapshot(parsed.data.data)
    trackEvent('sync_success', {
      recordCount: parsed.data.data.favorites.length + parsed.data.data.reviews.length
        + parsed.data.data.progress.length + parsed.data.data.activities.length,
    })
    Taro.removeStorageSync(SYNC_REQUEST_ID_KEY)
    Taro.removeStorageSync(SYNC_RETRY_KEY)
    clearFullSyncPending()
    return true
  } catch {
    const previous = Taro.getStorageSync<{ attempts?: number }>(SYNC_RETRY_KEY)
    const attempts = Math.min((previous?.attempts ?? 0) + 1, 10)
    const delay = Math.min(5 * 60_000, 2 ** (attempts - 1) * 2_000)
    try { Taro.setStorageSync(SYNC_RETRY_KEY, { attempts, nextAttemptAt: Date.now() + delay }) } catch { /* retry next launch */ }
    return false
  }
}

export async function pullFullSync() {
  try {
    const response = await authorizedRequest<unknown>({ path: '/v1/sync', method: 'GET' })
    const parsed = SyncResponseSchema.safeParse(response?.data)
    if (!response || response.statusCode !== 200 || !parsed.success) return false
    applySyncSnapshot(parsed.data.data)
    return true
  } catch { return false }
}

export function readLastSyncAt() {
  try {
    const value = Taro.getStorageSync<unknown>(LAST_SYNC_STORAGE_KEY)
    return typeof value === 'string' ? value : null
  } catch { return null }
}
