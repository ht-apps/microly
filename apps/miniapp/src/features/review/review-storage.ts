import Taro from '@tarojs/taro'
import type { TrainingSession } from '@microly/content-schema'

import type { TrainingProgress } from '../training/training-state'
import {
  REVIEW_INTERVALS,
  createReviewId,
  findChoiceCard,
  findTrainingOption,
  scheduleReviewAnswer,
  upsertReviewFromTraining,
  type ReviewItem,
} from './review-state'
import { markFullSyncPending } from '../sync/sync-pending'

export const REVIEW_STORAGE_KEY = 'microly:reviews:v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isReviewItem(value: unknown, session: TrainingSession) {
  if (!isRecord(value)) return false
  const choiceCard = findChoiceCard(session)
  const option = typeof value.lastSelectedOptionId === 'string'
    ? findTrainingOption(session, value.lastSelectedOptionId)
    : null

  return Boolean(
    choiceCard
    && option
    && value.reviewId === createReviewId(session.sessionId)
    && value.sessionId === session.sessionId
    && value.contentVersion === session.contentVersion
    && value.sourceCardId === choiceCard.id
    && REVIEW_INTERVALS.includes(value.intervalDays as never)
    && typeof value.consecutiveCorrect === 'number'
    && Number.isInteger(value.consecutiveCorrect)
    && value.consecutiveCorrect >= 0
    && (value.lastResult === 'correct' || value.lastResult === 'incorrect')
    && isIsoTime(value.dueAt)
    && isIsoTime(value.createdAt)
    && isIsoTime(value.updatedAt)
    && (value.lastReviewedAt === null || isIsoTime(value.lastReviewedAt)),
  )
}

export interface ReadReviewQueueResult {
  items: ReviewItem[]
  recoveredFromInvalid: boolean
}

export function parseReviewQueue(
  value: unknown,
  sessions: TrainingSession[],
): ReadReviewQueueResult {
  if (value === undefined || value === '') {
    return { items: [], recoveredFromInvalid: false }
  }
  if (!Array.isArray(value)) {
    return { items: [], recoveredFromInvalid: true }
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]))
  const reviewIds = new Set<string>()
  const items = value.flatMap((candidate): ReviewItem[] => {
    if (!isRecord(candidate) || typeof candidate.sessionId !== 'string') {
      return []
    }
    const session = sessionMap.get(candidate.sessionId)
    if (
      !session
      || !isReviewItem(candidate, session)
      || typeof candidate.reviewId !== 'string'
      || reviewIds.has(candidate.reviewId)
    ) {
      return []
    }
    reviewIds.add(candidate.reviewId)
    return [candidate as unknown as ReviewItem]
  })

  return {
    items,
    recoveredFromInvalid: items.length !== value.length,
  }
}

export function readReviewQueue(sessions: TrainingSession[]): ReadReviewQueueResult {
  try {
    return parseReviewQueue(
      Taro.getStorageSync<unknown>(REVIEW_STORAGE_KEY),
      sessions,
    )
  } catch {
    return { items: [], recoveredFromInvalid: true }
  }
}

export function writeReviewQueue(items: ReviewItem[]) {
  try {
    Taro.setStorageSync(REVIEW_STORAGE_KEY, items)
    markFullSyncPending()
    return true
  } catch {
    return false
  }
}

export interface SyncedReviewQueue extends ReadReviewQueueResult {
  writeFailed: boolean
}

export function syncReviewQueue(sessions: TrainingSession[]): SyncedReviewQueue {
  const stored = readReviewQueue(sessions)
  const writeFailed = stored.recoveredFromInvalid
    && !writeReviewQueue(stored.items)

  return {
    items: stored.items,
    recoveredFromInvalid: stored.recoveredFromInvalid,
    writeFailed,
  }
}

export function upsertCompletedTrainingReview(
  sessions: TrainingSession[],
  session: TrainingSession,
  progress: TrainingProgress,
) {
  const stored = readReviewQueue(sessions)
  const mutation = upsertReviewFromTraining(stored.items, session, progress)
  const shouldWrite = stored.recoveredFromInvalid || mutation.changed
  const writeFailed = shouldWrite && !writeReviewQueue(mutation.items)

  return {
    ...mutation,
    recoveredFromInvalid: stored.recoveredFromInvalid,
    writeFailed,
  }
}

export function saveReviewAnswer(
  sessions: TrainingSession[],
  item: ReviewItem,
  session: TrainingSession,
  selectedOptionId: string,
  answeredAt?: string,
) {
  const stored = readReviewQueue(sessions)
  const scheduled = scheduleReviewAnswer(
    item,
    session,
    selectedOptionId,
    answeredAt,
  )
  if (!scheduled) {
    return { result: null, writeFailed: false, recoveredFromInvalid: false }
  }

  const nextItems = stored.items.map((storedItem) => (
    storedItem.reviewId === item.reviewId ? scheduled.item : storedItem
  ))
  const itemExists = stored.items.some(
    (storedItem) => storedItem.reviewId === item.reviewId,
  )
  if (!itemExists) nextItems.push(scheduled.item)

  return {
    result: scheduled,
    writeFailed: !writeReviewQueue(nextItems),
    recoveredFromInvalid: stored.recoveredFromInvalid,
  }
}
