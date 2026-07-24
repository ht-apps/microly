import {
  TrainingContentBundleSchema,
  TrainingCatalogSchema,
  TrainingLibrarySchema,
  TrainingSessionSchema,
  type TrainingCatalog,
  type TrainingLibrary,
  type TrainingSession,
  type TrainingContentBundle,
} from '@microly/content-schema'

import actionCatalog from './data/action-catalog.json' with { type: 'json' }
import actionFollowupSession from './data/action-followup-009.json' with { type: 'json' }
import actionOwnerSession from './data/action-owner-010.json' with { type: 'json' }
import boundaryCatalog from './data/boundary-catalog.json' with { type: 'json' }
import boundaryDeadlineSession from './data/boundary-deadline-003.json' with { type: 'json' }
import boundaryDeclineSession from './data/boundary-decline-001.json' with { type: 'json' }
import boundaryPrioritySession from './data/boundary-priority-002.json' with { type: 'json' }
import disagreementCatalog from './data/disagreement-catalog.json' with { type: 'json' }
import disagreeAlternativeSession from './data/disagree-alternative-008.json' with { type: 'json' }
import disagreeGoalSession from './data/disagree-goal-007.json' with { type: 'json' }
import reportingCatalog from './data/reporting-catalog.json' with { type: 'json' }
import reportConclusionSession from './data/report-conclusion-004.json' with { type: 'json' }
import reportRiskSession from './data/report-risk-005.json' with { type: 'json' }
import reportSupportSession from './data/report-support-006.json' with { type: 'json' }
import rawLibrary from './data/training-library.json' with { type: 'json' }
import { betaProductionPlan, buildBetaSession } from './beta-content.js'

export { betaProductionPlan } from './beta-content.js'

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

export const catalogInputs: Record<string, unknown> = {
  'boundary-communication': boundaryCatalog,
  'clear-reporting': reportingCatalog,
  'constructive-disagreement': disagreementCatalog,
  'action-alignment': actionCatalog,
}

export const sessionInputs: Record<string, unknown> = {
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

export const trainingContentBundle: TrainingContentBundle = TrainingContentBundleSchema.parse({
  releaseVersion: 1,
  library: rawLibrary,
  catalogs: catalogInputs,
  sessions: sessionInputs,
})

function addSeedReviewVariants(session: TrainingSession, index: number): TrainingSession {
  if (session.reviewVariants.length >= 2) return session
  const scenario = session.cards.find((card) => card.type === 'scenario')!
  const choice = session.cards.find((card) => card.type === 'choice')!
  const createVariant = (number: number) => ({
    variantId: `${session.sessionId}-review-${number}`,
    title: number === 1 ? `${session.title}：条件变化` : `${session.title}：协作变化`,
    context: number === 1
      ? `同一学习目标出现在另一段匿名职场协作中。原有时间条件发生变化，你需要重新判断如何表达，并确认可以执行的下一步。`
      : `这次沟通对象和协作限制有所不同，但仍需要围绕“${session.objective}”组织表达，避免评价个人。`,
    question: number === 1 ? '条件变化后，你会怎样回应？' : scenario.question,
    prompt: number === 1 ? '选择更能管理变化预期的一句话' : '选择更能推动共同确认的一句话',
    options: choice.options.map((option, optionIndex) => ({
      ...option,
      id: `${session.sessionId}-review-${number}-${optionIndex + 1}`,
      text: `${number === 1 ? '条件变化后' : '对象变化后'}：${option.text}`,
    })).map((_, optionIndex, options) => options[(optionIndex + index + number) % options.length]!),
  })
  // The remote seed is a fresh release snapshot, so its initial entity versions
  // remain at 1. Existing databases receive the same change through publishing,
  // where the server performs the normal contentVersion increment.
  return TrainingSessionSchema.parse({ ...session, reviewVariants: [createVariant(1), createVariant(2)] })
}

const remoteSessions: Record<string, TrainingSession> = Object.fromEntries([
  ...Object.values(TrainingContentBundleSchema.parse(trainingContentBundle).sessions).map((session, index) => [session.sessionId, addSeedReviewVariants(session, index)] as const),
  ...betaProductionPlan.map((spec, index) => [spec.sessionId, buildBetaSession(spec, index)] as const),
])
const remoteCatalogs: Record<string, TrainingCatalog> = Object.fromEntries(
  Object.entries(TrainingContentBundleSchema.parse(trainingContentBundle).catalogs).map(([catalogId, catalog]) => [catalogId, {
    ...catalog,
    contentVersion: catalog.contentVersion + 1,
    sessionIds: [...catalog.sessionIds, ...betaProductionPlan.filter((spec) => spec.catalogId === catalogId).map((spec) => spec.sessionId)],
  }]),
)

export const remoteTrainingContentBundle: TrainingContentBundle = TrainingContentBundleSchema.parse({
  releaseVersion: 1,
  library: { ...TrainingContentBundleSchema.parse(trainingContentBundle).library, contentVersion: 2 },
  catalogs: remoteCatalogs,
  sessions: remoteSessions,
})

export let currentTrainingContentBundle = trainingContentBundle

export function setTrainingContentBundle(input: unknown) {
  const loaded = loadTrainingContentBundle(input)
  if (!loaded) return false
  currentTrainingContentBundle = loaded.bundle
  Object.assign(trainingContent, loaded.repository)
  return true
}

export function loadTrainingContentBundle(input: unknown) {
  const result = TrainingContentBundleSchema.safeParse(input)
  if (!result.success) return null
  const bundle = result.data
  return {
    bundle,
    repository: loadTrainingContent(bundle.library, bundle.catalogs, bundle.sessions),
  }
}

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
