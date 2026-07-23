import Taro from '@tarojs/taro'

import {
  createCompletedPreference,
  parseUserPreference,
  resolveOnboardingDecision,
  type UserPreference,
} from './preference-state'
import { markFullSyncPending } from '../sync/sync-pending'

export const PREFERENCE_STORAGE_KEY = 'microly:preferences:v1'

export function readUserPreference(availableCatalogIds: string[]) {
  try {
    return parseUserPreference(
      Taro.getStorageSync<unknown>(PREFERENCE_STORAGE_KEY),
      availableCatalogIds,
    )
  } catch {
    return {
      preference: null,
      recoveredFromInvalid: true,
      missing: false,
    }
  }
}

export function writeUserPreference(preference: UserPreference) {
  try {
    Taro.setStorageSync(PREFERENCE_STORAGE_KEY, preference)
    markFullSyncPending()
    return true
  } catch {
    return false
  }
}

export function syncUserPreference(availableCatalogIds: string[]) {
  const parsed = readUserPreference(availableCatalogIds)
  const shouldWrite = Boolean(parsed.preference && parsed.recoveredFromInvalid)
  return {
    ...parsed,
    writeFailed:
      shouldWrite && !writeUserPreference(parsed.preference as UserPreference),
  }
}

export function saveUserPreference(
  selectedCatalogIds: string[],
  existingPreference?: UserPreference | null,
  now = new Date().toISOString(),
) {
  const preference = createCompletedPreference(
    selectedCatalogIds,
    now,
    existingPreference?.completedAt ?? now,
  )
  return {
    preference,
    writeFailed: !writeUserPreference(preference),
  }
}

export function resolveStoredOnboarding(
  availableCatalogIds: string[],
) {
  const parsed = readUserPreference(availableCatalogIds)
  const decision = resolveOnboardingDecision(parsed)
  const preference = decision.action === 'open_today'
    ? decision.preference
    : null
  const shouldWrite = Boolean(preference && parsed.recoveredFromInvalid)
  return {
    decision,
    recoveredFromInvalid: parsed.recoveredFromInvalid,
    writeFailed: shouldWrite && !writeUserPreference(preference as UserPreference),
  }
}
