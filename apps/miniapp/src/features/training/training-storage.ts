import Taro from '@tarojs/taro'
import type { TrainingSession } from '@microly/content-schema'

import {
  parseTrainingProgress,
  type ParsedTrainingProgress,
  type TrainingProgress,
} from './training-state'
import { markFullSyncPending } from '../sync/sync-pending'

export function getTrainingStorageKey(
  session: Pick<TrainingSession, 'sessionId' | 'contentVersion'>,
) {
  return `microly:training:${session.sessionId}:v${session.contentVersion}`
}

export function getPrivateDraftStorageKey(
  session: Pick<TrainingSession, 'sessionId' | 'contentVersion'>,
) {
  return `microly:training-private:${session.sessionId}:v${session.contentVersion}`
}

export function readTrainingProgress(
  session: TrainingSession,
): ParsedTrainingProgress {
  try {
    const storedValue = Taro.getStorageSync<Record<string, unknown>>(
      getTrainingStorageKey(session),
    )
    const privateDraft = Taro.getStorageSync<Record<string, unknown>>(
      getPrivateDraftStorageKey(session),
    )
    return parseTrainingProgress(
      storedValue && typeof storedValue === 'object'
        ? { ...storedValue, ...(privateDraft && typeof privateDraft === 'object' ? privateDraft : {}) }
        : storedValue,
      session,
    )
  } catch {
    return {
      ...parseTrainingProgress(undefined, session),
      recoveredFromInvalid: true,
    }
  }
}

export function writeTrainingProgress(progress: TrainingProgress) {
  try {
    const { practiceText, practiceEvaluation, otherFeedbackExpanded, ...safeProgress } = progress
    Taro.setStorageSync(getTrainingStorageKey(progress), {
      ...safeProgress,
      practiceText: '',
      practiceEvaluation: progress.status === 'completed' ? [] : null,
      otherFeedbackExpanded: false,
    })
    Taro.setStorageSync(getPrivateDraftStorageKey(progress), {
      practiceText,
      practiceEvaluation,
      otherFeedbackExpanded,
    })
    markFullSyncPending()
    return true
  } catch {
    return false
  }
}

export function clearTrainingProgress(
  session: Pick<TrainingSession, 'sessionId' | 'contentVersion'>,
) {
  try {
    Taro.removeStorageSync(getTrainingStorageKey(session))
    Taro.removeStorageSync(getPrivateDraftStorageKey(session))
    markFullSyncPending()
    return true
  } catch {
    return false
  }
}

export interface TrainingProgressCollection {
  progressBySessionId: Record<string, TrainingProgress>
  recoveredSessionIds: string[]
}

export function readAllTrainingProgress(
  sessions: TrainingSession[],
): TrainingProgressCollection {
  const progressBySessionId: Record<string, TrainingProgress> = {}
  const recoveredSessionIds: string[] = []

  sessions.forEach((session) => {
    const stored = readTrainingProgress(session)
    progressBySessionId[session.sessionId] = stored.progress
    if (stored.recoveredFromInvalid) {
      recoveredSessionIds.push(session.sessionId)
    }
  })

  return { progressBySessionId, recoveredSessionIds }
}
