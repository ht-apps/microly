import Taro from '@tarojs/taro'
import type { FavoriteSyncRecord } from '@microly/api-contract'
import type { TrainingSession } from '@microly/content-schema'

import {
  addFavorite,
  createFavoriteId,
  findPrincipleCard,
  parseFavoriteQueue,
  removeFavorite,
  type FavoriteItem,
} from './favorite-state'
import { markFullSyncPending } from '../sync/sync-pending'

export const FAVORITE_STORAGE_KEY = 'microly:favorites:v1'
export const FAVORITE_SYNC_STORAGE_KEY = 'microly:favorites:sync:v1'

export function readFavoriteSyncRecords(): FavoriteSyncRecord[] {
  try {
    const value = Taro.getStorageSync<unknown>(FAVORITE_SYNC_STORAGE_KEY)
    return Array.isArray(value) ? value as FavoriteSyncRecord[] : []
  } catch { return [] }
}

export function writeFavoriteSyncRecords(records: FavoriteSyncRecord[]) {
  try { Taro.setStorageSync(FAVORITE_SYNC_STORAGE_KEY, records); return true } catch { return false }
}

export function readFavoriteQueue(sessions: TrainingSession[]) {
  try {
    return parseFavoriteQueue(
      Taro.getStorageSync<unknown>(FAVORITE_STORAGE_KEY),
      sessions,
    )
  } catch {
    return {
      items: [] as FavoriteItem[],
      resolvedItems: [],
      recoveredFromInvalid: true,
    }
  }
}

export function writeFavoriteQueue(items: FavoriteItem[]) {
  try {
    Taro.setStorageSync(FAVORITE_STORAGE_KEY, items)
    markFullSyncPending()
    return true
  } catch {
    return false
  }
}

export function syncFavoriteQueue(sessions: TrainingSession[]) {
  const stored = readFavoriteQueue(sessions)
  const writeFailed = stored.recoveredFromInvalid
    && !writeFavoriteQueue(stored.items)

  return {
    ...stored,
    writeFailed,
  }
}

export function setSessionFavorite(
  sessions: TrainingSession[],
  session: TrainingSession,
  shouldFavorite: boolean,
  now?: string,
) {
  const stored = readFavoriteQueue(sessions)
  const principleCard = findPrincipleCard(session)
  if (!principleCard) {
    return {
      isFavorite: false,
      writeFailed: false,
      recoveredFromInvalid: stored.recoveredFromInvalid,
    }
  }

  const mutation = shouldFavorite
    ? addFavorite(stored.items, session, now)
    : removeFavorite(
        stored.items,
        createFavoriteId(session.sessionId, principleCard.id),
      )
  const shouldWrite = stored.recoveredFromInvalid || mutation.changed
  if (mutation.changed) {
    const timestamp = now ?? new Date().toISOString()
    const favoriteId = createFavoriteId(session.sessionId, principleCard.id)
    const previous = readFavoriteSyncRecords().filter((item) => item.favoriteId !== favoriteId)
    writeFavoriteSyncRecords([...previous, {
      favoriteId,
      sessionId: session.sessionId,
      contentVersion: session.contentVersion,
      cardId: principleCard.id,
      active: shouldFavorite,
      createdAt: shouldFavorite ? timestamp : stored.items.find((item) => item.favoriteId === favoriteId)?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }])
    markFullSyncPending()
  }

  return {
    isFavorite: shouldFavorite,
    writeFailed: shouldWrite && !writeFavoriteQueue(mutation.items),
    recoveredFromInvalid: stored.recoveredFromInvalid,
  }
}
