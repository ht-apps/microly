import Taro from '@tarojs/taro'

import {
  createCompletedPreference,
  parseUserPreference,
  resolveOnboardingDecision,
  type UserPreference,
} from './preference-state'

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
  hasExistingLearningData: boolean,
  now = new Date().toISOString(),
) {
  const parsed = readUserPreference(availableCatalogIds)
  const decision = resolveOnboardingDecision(
    parsed,
    hasExistingLearningData,
    now,
  )
  const preference = decision.action === 'open_today'
    ? decision.preference
    : null
  const migratedLegacy = decision.action === 'open_today'
    && decision.migratedLegacy
  const shouldWrite = Boolean(
    preference && (parsed.recoveredFromInvalid || migratedLegacy),
  )
  return {
    decision,
    recoveredFromInvalid: parsed.recoveredFromInvalid,
    writeFailed: shouldWrite && !writeUserPreference(preference as UserPreference),
  }
}
