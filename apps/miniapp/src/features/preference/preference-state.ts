export const PREFERENCE_SCHEMA_VERSION = 1
export const MAX_PREFERENCE_COUNT = 2

export interface UserPreference {
  schemaVersion: 1
  onboardingStatus: 'completed'
  selectedCatalogIds: string[]
  completedAt: string
  updatedAt: string
}

export interface ParsedUserPreference {
  preference: UserPreference | null
  recoveredFromInvalid: boolean
  missing: boolean
}

export type OnboardingDecision =
  | { action: 'show_onboarding'; preference: null }
  | { action: 'open_today'; preference: UserPreference }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function createCompletedPreference(
  selectedCatalogIds: string[],
  now = new Date().toISOString(),
  completedAt = now,
): UserPreference {
  return {
    schemaVersion: PREFERENCE_SCHEMA_VERSION,
    onboardingStatus: 'completed',
    selectedCatalogIds: selectedCatalogIds.slice(0, MAX_PREFERENCE_COUNT),
    completedAt,
    updatedAt: now,
  }
}

export function parseUserPreference(
  value: unknown,
  availableCatalogIds: string[],
): ParsedUserPreference {
  if (value === undefined || value === '') {
    return { preference: null, recoveredFromInvalid: false, missing: true }
  }
  if (
    !isRecord(value)
    || value.schemaVersion !== PREFERENCE_SCHEMA_VERSION
    || value.onboardingStatus !== 'completed'
    || !Array.isArray(value.selectedCatalogIds)
    || !value.selectedCatalogIds.every((id) => typeof id === 'string')
    || !isIsoTime(value.completedAt)
    || !isIsoTime(value.updatedAt)
  ) {
    return { preference: null, recoveredFromInvalid: true, missing: false }
  }

  const availableIds = new Set(availableCatalogIds)
  const seenIds = new Set<string>()
  const selectedCatalogIds = value.selectedCatalogIds.flatMap((id): string[] => {
    if (
      !availableIds.has(id)
      || seenIds.has(id)
      || seenIds.size >= MAX_PREFERENCE_COUNT
    ) return []
    seenIds.add(id)
    return [id]
  })
  const recoveredFromInvalid =
    selectedCatalogIds.length !== value.selectedCatalogIds.length

  return {
    preference: {
      schemaVersion: PREFERENCE_SCHEMA_VERSION,
      onboardingStatus: 'completed',
      selectedCatalogIds,
      completedAt: value.completedAt,
      updatedAt: value.updatedAt,
    },
    recoveredFromInvalid,
    missing: false,
  }
}

export function toggleCatalogPreference(
  selectedCatalogIds: string[],
  catalogId: string,
) {
  if (selectedCatalogIds.includes(catalogId)) {
    return {
      selectedCatalogIds: selectedCatalogIds.filter((id) => id !== catalogId),
      limitReached: false,
    }
  }
  if (selectedCatalogIds.length >= MAX_PREFERENCE_COUNT) {
    return { selectedCatalogIds, limitReached: true }
  }
  return {
    selectedCatalogIds: [...selectedCatalogIds, catalogId],
    limitReached: false,
  }
}

export function resolveOnboardingDecision(
  parsed: ParsedUserPreference,
): OnboardingDecision {
  if (parsed.preference) {
    return {
      action: 'open_today',
      preference: parsed.preference,
    }
  }
  return { action: 'show_onboarding', preference: null }
}
