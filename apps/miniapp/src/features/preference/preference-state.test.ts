import { describe, expect, it } from 'vitest'

import {
  createCompletedPreference,
  parseUserPreference,
  resolveOnboardingDecision,
  toggleCatalogPreference,
} from './preference-state'

const catalogIds = [
  'boundary-communication',
  'clear-reporting',
  'constructive-disagreement',
  'action-alignment',
]
const now = '2026-07-23T08:00:00.000Z'

describe('user preference state', () => {
  it('支持选择一至两项或跳过', () => {
    const empty = createCompletedPreference([], now)
    const selected = createCompletedPreference(catalogIds.slice(0, 2), now)
    expect(empty.selectedCatalogIds).toEqual([])
    expect(selected.selectedCatalogIds).toEqual(catalogIds.slice(0, 2))
  })

  it('第三项不会替换已有选择', () => {
    const result = toggleCatalogPreference(catalogIds.slice(0, 2), catalogIds[2])
    expect(result.limitReached).toBe(true)
    expect(result.selectedCatalogIds).toEqual(catalogIds.slice(0, 2))

    const removed = toggleCatalogPreference(catalogIds.slice(0, 2), catalogIds[0])
    expect(removed.selectedCatalogIds).toEqual([catalogIds[1]])
  })

  it('清理重复、未知和超过上限的章节', () => {
    const parsed = parseUserPreference({
      ...createCompletedPreference([], now),
      selectedCatalogIds: [
        catalogIds[0],
        catalogIds[0],
        'removed-catalog',
        catalogIds[1],
        catalogIds[2],
      ],
    }, catalogIds)
    expect(parsed.preference?.selectedCatalogIds).toEqual(catalogIds.slice(0, 2))
    expect(parsed.recoveredFromInvalid).toBe(true)
  })

  it('区分全新用户、已完成引导和旧用户迁移', () => {
    const missing = parseUserPreference(undefined, catalogIds)
    expect(resolveOnboardingDecision(missing, false).action).toBe('show_onboarding')

    const completed = parseUserPreference(
      createCompletedPreference([catalogIds[1]], now),
      catalogIds,
    )
    expect(resolveOnboardingDecision(completed, false)).toMatchObject({
      action: 'open_today',
      migratedLegacy: false,
    })

    expect(resolveOnboardingDecision(missing, true, now)).toMatchObject({
      action: 'open_today',
      migratedLegacy: true,
      preference: { selectedCatalogIds: [] },
    })
  })

  it('损坏偏好不会阻塞旧用户，新用户重新显示引导', () => {
    const invalid = parseUserPreference({ invalid: true }, catalogIds)
    expect(resolveOnboardingDecision(invalid, false).action).toBe('show_onboarding')
    expect(resolveOnboardingDecision(invalid, true).action).toBe('open_today')
  })
})
