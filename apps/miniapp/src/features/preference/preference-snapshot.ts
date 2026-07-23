import { trainingContent } from '../../data/training-content'
import { syncUserPreference } from './preference-storage'

export function readPreferenceSnapshot() {
  const catalogs = trainingContent.chapters.flatMap(
    (chapter) => chapter.catalog ? [chapter.catalog] : [],
  )
  const stored = syncUserPreference(
    catalogs.map((catalog) => catalog.catalogId),
  )
  const selectedCatalogIds = stored.preference?.selectedCatalogIds ?? []
  const selectedCatalogs = selectedCatalogIds.flatMap((catalogId) => {
    const catalog = catalogs.find((item) => item.catalogId === catalogId)
    return catalog ? [catalog] : []
  })

  return {
    preference: stored.preference,
    selectedCatalogIds,
    selectedCatalogs,
    summary: selectedCatalogs.length > 0
      ? selectedCatalogs.map((catalog) => catalog.title).join('、')
      : '暂未设置，可选择 1～2 项重点能力',
    recoveredFromInvalid: stored.recoveredFromInvalid,
    writeFailed: stored.writeFailed,
  }
}
