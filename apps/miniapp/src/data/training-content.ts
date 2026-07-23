import {
  TrainingCatalogSchema,
  TrainingLibrarySchema,
  TrainingSessionSchema,
  type TrainingCatalog,
  type TrainingLibrary,
  type TrainingSession,
} from '@microly/content-schema'

import actionCatalog from './action-catalog.json'
import actionFollowupSession from './action-followup-009.json'
import actionOwnerSession from './action-owner-010.json'
import boundaryCatalog from './boundary-catalog.json'
import boundaryDeadlineSession from './boundary-deadline-003.json'
import boundaryDeclineSession from './boundary-decline-001.json'
import boundaryPrioritySession from './boundary-priority-002.json'
import disagreementCatalog from './disagreement-catalog.json'
import disagreeAlternativeSession from './disagree-alternative-008.json'
import disagreeGoalSession from './disagree-goal-007.json'
import reportingCatalog from './reporting-catalog.json'
import reportConclusionSession from './report-conclusion-004.json'
import reportRiskSession from './report-risk-005.json'
import reportSupportSession from './report-support-006.json'
import rawLibrary from './training-library.json'

export type TrainingContentErrorScope = 'library' | 'catalog' | 'session'

export interface TrainingContentError {
  scope: TrainingContentErrorScope
  contentId: string
  message: string
}

export interface TrainingContentEntry {
  catalogId: string
  sessionId: string
  session: TrainingSession | null
  error: string | null
}

export interface TrainingContentChapter {
  catalogId: string
  catalog: TrainingCatalog | null
  entries: TrainingContentEntry[]
  sessions: TrainingSession[]
  error: string | null
}

export interface TrainingContentRepository {
  library: TrainingLibrary | null
  chapters: TrainingContentChapter[]
  entries: TrainingContentEntry[]
  sessions: TrainingSession[]
  errors: TrainingContentError[]
}

function error(
  scope: TrainingContentErrorScope,
  contentId: string,
  message: string,
): TrainingContentError {
  return { scope, contentId, message }
}

export function loadTrainingContent(
  libraryInput: unknown,
  catalogInputs: Record<string, unknown>,
  sessionInputs: Record<string, unknown>,
): TrainingContentRepository {
  const libraryResult = TrainingLibrarySchema.safeParse(libraryInput)
  if (!libraryResult.success) {
    return {
      library: null,
      chapters: [],
      entries: [],
      sessions: [],
      errors: [error('library', 'library', '课程库没有通过内容校验')],
    }
  }

  const library = libraryResult.data
  const errors: TrainingContentError[] = []
  const seenSessionIds = new Set<string>()
  const chapters = library.catalogIds.map((catalogId): TrainingContentChapter => {
    const catalogResult = TrainingCatalogSchema.safeParse(catalogInputs[catalogId])
    let catalogError: string | null = null

    if (!catalogResult.success) {
      catalogError = '章节目录没有通过校验'
    } else if (catalogResult.data.catalogId !== catalogId) {
      catalogError = '章节目录 ID 与课程库不一致'
    }

    if (catalogError || !catalogResult.success) {
      errors.push(error('catalog', catalogId, catalogError ?? '章节目录没有通过校验'))
      return {
        catalogId,
        catalog: null,
        entries: [],
        sessions: [],
        error: catalogError ?? '章节目录没有通过校验',
      }
    }

    const catalog = catalogResult.data
    const entries = catalog.sessionIds.map((sessionId): TrainingContentEntry => {
      let message: string | null = null
      if (seenSessionIds.has(sessionId)) {
        message = '训练 ID 在多个章节中重复'
      } else {
        seenSessionIds.add(sessionId)
      }

      const sessionResult = TrainingSessionSchema.safeParse(sessionInputs[sessionId])
      if (!message && !sessionResult.success) {
        message = '训练内容没有通过校验'
      } else if (
        !message
        && sessionResult.success
        && sessionResult.data.sessionId !== sessionId
      ) {
        message = '训练内容 ID 与目录不一致'
      } else if (
        !message
        && sessionResult.success
        && sessionResult.data.skill !== catalog.skill
      ) {
        message = '训练内容技能与章节不一致'
      }

      if (message) {
        errors.push(error('session', sessionId, message))
        return { catalogId, sessionId, session: null, error: message }
      }

      return {
        catalogId,
        sessionId,
        session: sessionResult.success ? sessionResult.data : null,
        error: null,
      }
    })

    return {
      catalogId,
      catalog,
      entries,
      sessions: entries.flatMap((entry) => entry.session ? [entry.session] : []),
      error: null,
    }
  })

  const entries = chapters.flatMap((chapter) => chapter.entries)
  return {
    library,
    chapters,
    entries,
    sessions: entries.flatMap((entry) => entry.session ? [entry.session] : []),
    errors,
  }
}

const catalogInputs: Record<string, unknown> = {
  'boundary-communication': boundaryCatalog,
  'clear-reporting': reportingCatalog,
  'constructive-disagreement': disagreementCatalog,
  'action-alignment': actionCatalog,
}

const sessionInputs: Record<string, unknown> = {
  'boundary-decline-001': boundaryDeclineSession,
  'boundary-priority-002': boundaryPrioritySession,
  'boundary-deadline-003': boundaryDeadlineSession,
  'report-conclusion-004': reportConclusionSession,
  'report-risk-005': reportRiskSession,
  'report-support-006': reportSupportSession,
  'disagree-goal-007': disagreeGoalSession,
  'disagree-alternative-008': disagreeAlternativeSession,
  'action-followup-009': actionFollowupSession,
  'action-owner-010': actionOwnerSession,
}

export const trainingContent = loadTrainingContent(
  rawLibrary,
  catalogInputs,
  sessionInputs,
)

export function getTrainingEntry(sessionId: string) {
  return trainingContent.entries.find((entry) => entry.sessionId === sessionId)
}

export function getTrainingSession(sessionId: string) {
  return getTrainingEntry(sessionId)?.session ?? null
}

export function getTrainingChapter(sessionId: string) {
  const entry = getTrainingEntry(sessionId)
  return entry
    ? trainingContent.chapters.find((chapter) => chapter.catalogId === entry.catalogId) ?? null
    : null
}

export function getFirstAvailableTraining() {
  return trainingContent.sessions[0] ?? null
}
