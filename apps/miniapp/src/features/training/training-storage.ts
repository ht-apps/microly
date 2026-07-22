import Taro from '@tarojs/taro'
import type { TrainingSession } from '@microly/content-schema'

import {
  parseTrainingProgress,
  type ParsedTrainingProgress,
  type TrainingProgress,
} from './training-state'

export function getTrainingStorageKey(
  session: Pick<TrainingSession, 'sessionId' | 'contentVersion'>,
) {
  return `microly:training:${session.sessionId}:v${session.contentVersion}`
}

export function readTrainingProgress(
  session: TrainingSession,
): ParsedTrainingProgress {
  try {
    const storedValue = Taro.getStorageSync<unknown>(
      getTrainingStorageKey(session),
    )
    return parseTrainingProgress(storedValue, session)
  } catch {
    return {
      ...parseTrainingProgress(undefined, session),
      recoveredFromInvalid: true,
    }
  }
}

export function writeTrainingProgress(progress: TrainingProgress) {
  try {
    Taro.setStorageSync(getTrainingStorageKey(progress), progress)
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
