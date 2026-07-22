import {
  TrainingCatalogSchema,
  TrainingSessionSchema,
  type TrainingCatalog,
  type TrainingSession,
} from '@microly/content-schema'

import rawCatalog from './boundary-catalog.json'
import boundaryDeadlineSession from './boundary-deadline-003.json'
import boundaryDeclineSession from './boundary-decline-001.json'
import boundaryPrioritySession from './boundary-priority-002.json'

export interface TrainingContentError {
  sessionId: string
  message: string
}

export interface TrainingContentEntry {
  sessionId: string
  session: TrainingSession | null
  error: string | null
}

export interface TrainingContentRepository {
  catalog: TrainingCatalog | null
  entries: TrainingContentEntry[]
  sessions: TrainingSession[]
  errors: TrainingContentError[]
}

export function loadTrainingContent(
  catalogInput: unknown,
  sessionInputs: Record<string, unknown>,
): TrainingContentRepository {
  const catalogResult = TrainingCatalogSchema.safeParse(catalogInput)
  if (!catalogResult.success) {
    return {
      catalog: null,
      entries: [],
      sessions: [],
      errors: [{
        sessionId: 'catalog',
        message: '训练目录没有通过内容校验',
      }],
    }
  }

  const catalog = catalogResult.data
  const errors: TrainingContentError[] = []
  const entries = catalog.sessionIds.map((sessionId): TrainingContentEntry => {
    const sessionResult = TrainingSessionSchema.safeParse(sessionInputs[sessionId])
    let message: string | null = null

    if (!sessionResult.success) {
      message = '训练内容没有通过校验'
    } else if (sessionResult.data.sessionId !== sessionId) {
      message = '训练内容 ID 与目录不一致'
    } else if (sessionResult.data.skill !== catalog.skill) {
      message = '训练内容技能与目录不一致'
    }

    if (message) {
      errors.push({ sessionId, message })
      return { sessionId, session: null, error: message }
    }

    return {
      sessionId,
      session: sessionResult.success ? sessionResult.data : null,
      error: null,
    }
  })

  return {
    catalog,
    entries,
    sessions: entries.flatMap((entry) => entry.session ? [entry.session] : []),
    errors,
  }
}

const sessionInputs: Record<string, unknown> = {
  'boundary-decline-001': boundaryDeclineSession,
  'boundary-priority-002': boundaryPrioritySession,
  'boundary-deadline-003': boundaryDeadlineSession,
}

export const trainingContent = loadTrainingContent(rawCatalog, sessionInputs)

export function getTrainingEntry(sessionId: string) {
  return trainingContent.entries.find((entry) => entry.sessionId === sessionId)
}

export function getTrainingSession(sessionId: string) {
  return getTrainingEntry(sessionId)?.session ?? null
}

export function getFirstAvailableTraining() {
  return trainingContent.sessions[0] ?? null
}
