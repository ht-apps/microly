import Taro from '@tarojs/taro'
import type { TrainingSession } from '@microly/content-schema'

import {
  addFavorite,
  createFavoriteId,
  findPrincipleCard,
  parseFavoriteQueue,
  removeFavorite,
  type FavoriteItem,
} from './favorite-state'

export const FAVORITE_STORAGE_KEY = 'microly:favorites:v1'

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

  return {
    isFavorite: shouldFavorite,
    writeFailed: shouldWrite && !writeFavoriteQueue(mutation.items),
    recoveredFromInvalid: stored.recoveredFromInvalid,
  }
}
