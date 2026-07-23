import {
  TrainingCompletionListResponseSchema,
  TrainingCompletionResponseSchema,
  TrainingCompletionSchema,
  type TrainingCompletion,
} from '@microly/api-contract'
import type { TrainingSession } from '@microly/content-schema'
import Taro from '@tarojs/taro'

import { authorizedRequest } from '../network/guest-auth'
import { createInitialProgress, type TrainingProgress } from '../training/training-state'
import { readTrainingProgress, writeTrainingProgress } from '../training/training-storage'

export const COMPLETION_OUTBOX_STORAGE_KEY = 'microly:sync:completion-outbox:v1'

export function createCompletionSyncId(progress: TrainingProgress) {
  if (!progress.completedAt) return null
  return `completion:${progress.sessionId}:v${progress.contentVersion}:${progress.completedAt}`
}

export function completionFromProgress(progress: TrainingProgress): TrainingCompletion | null {
  const syncId = createCompletionSyncId(progress)
  if (
    progress.status !== 'completed'
    || !syncId
    || !progress.selectedOptionId
    || !progress.startedAt
    || !progress.completedAt
  ) return null
  return {
    syncId,
    sessionId: progress.sessionId,
    contentVersion: progress.contentVersion,
    selectedOptionId: progress.selectedOptionId,
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
  }
}

export function parseCompletionOutbox(value: unknown) {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.flatMap((item): TrainingCompletion[] => {
    const parsed = TrainingCompletionSchema.safeParse(item)
    if (!parsed.success || ids.has(parsed.data.syncId)) return []
    ids.add(parsed.data.syncId)
    return [parsed.data]
  })
}

function readOutbox() {
  try {
    return parseCompletionOutbox(Taro.getStorageSync(COMPLETION_OUTBOX_STORAGE_KEY))
  } catch {
    return []
  }
}

function writeOutbox(items: TrainingCompletion[]) {
  try {
    Taro.setStorageSync(COMPLETION_OUTBOX_STORAGE_KEY, items)
    return true
  } catch {
    return false
  }
}

export function enqueueTrainingCompletion(progress: TrainingProgress) {
  const completion = completionFromProgress(progress)
  if (!completion) return false
  const current = readOutbox()
  if (current.some((item) => item.syncId === completion.syncId)) return true
  return writeOutbox([...current, completion])
}

export function backfillCompletionOutbox(sessions: TrainingSession[]) {
  sessions.forEach((session) => {
    enqueueTrainingCompletion(readTrainingProgress(session).progress)
  })
}

export async function flushCompletionOutbox() {
  const pending = readOutbox()
  if (pending.length === 0) return 0
  const remaining: TrainingCompletion[] = []
  let synced = 0
  for (const completion of pending) {
    try {
      const response = await authorizedRequest<unknown>({
        path: '/v1/training-completions',
        method: 'POST',
        data: completion,
      })
      const parsed = TrainingCompletionResponseSchema.safeParse(response?.data)
      if (response && response.statusCode >= 200 && response.statusCode < 300 && parsed.success) {
        synced += 1
      } else {
        remaining.push(completion)
      }
    } catch {
      remaining.push(completion)
    }
  }
  writeOutbox(remaining)
  return synced
}

export async function restoreServerCompletions(sessions: TrainingSession[]) {
  try {
    const response = await authorizedRequest<unknown>({
      path: '/v1/training-completions',
      method: 'GET',
    })
    const parsed = TrainingCompletionListResponseSchema.safeParse(response?.data)
    if (!response || response.statusCode !== 200 || !parsed.success) return 0
    const sessionMap = new Map(sessions.map((session) => [
      `${session.sessionId}:v${session.contentVersion}`,
      session,
    ]))
    let restored = 0
    parsed.data.data.forEach((completion) => {
      const session = sessionMap.get(`${completion.sessionId}:v${completion.contentVersion}`)
      if (!session) return
      const stored = readTrainingProgress(session).progress
      if (stored.status === 'completed' || Date.parse(stored.updatedAt) > Date.parse(completion.completedAt)) return
      const progress: TrainingProgress = {
        ...createInitialProgress(session, completion.startedAt),
        status: 'completed',
        currentCardIndex: session.cards.length - 1,
        selectedOptionId: completion.selectedOptionId,
        choiceConfirmed: true,
        practiceEvaluation: [],
        startedAt: completion.startedAt,
        updatedAt: completion.completedAt,
        completedAt: completion.completedAt,
      }
      if (writeTrainingProgress(progress)) restored += 1
    })
    return restored
  } catch {
    return 0
  }
}
