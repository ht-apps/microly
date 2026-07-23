import Taro from '@tarojs/taro'
import type { TrainingSession } from '@microly/content-schema'

import type { TrainingProgress } from '../training/training-state'
import {
  backfillTrainingActivity,
  mergeLearningActivityEvent,
  toLocalDateKey,
  type LearningActivityEvent,
} from './activity-state'

export const LEARNING_ACTIVITY_STORAGE_KEY = 'microly:learning-activity:v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isDateKey(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isLearningActivityEvent(
  value: unknown,
  sessionIds: Set<string>,
): value is LearningActivityEvent {
  if (
    !isRecord(value)
    || typeof value.eventId !== 'string'
    || !isIsoTime(value.occurredAt)
    || !isDateKey(value.localDateKey)
    || typeof value.sessionId !== 'string'
    || !sessionIds.has(value.sessionId)
    || value.localDateKey !== toLocalDateKey(value.occurredAt)
  ) return false

  if (value.type === 'training_completed') {
    return value.eventId === `training_completed:${value.sessionId}:${value.occurredAt}`
  }
  if (value.type === 'due_review_answered' && typeof value.reviewId === 'string') {
    return (
      value.reviewId.startsWith(`${value.sessionId}:`)
      && value.eventId === `due_review_answered:${value.reviewId}:${value.occurredAt}`
    )
  }
  return false
}

export function parseLearningActivity(
  value: unknown,
  sessions: TrainingSession[],
) {
  if (value === undefined || value === '') {
    return { events: [] as LearningActivityEvent[], recoveredFromInvalid: false }
  }
  if (!Array.isArray(value)) {
    return { events: [] as LearningActivityEvent[], recoveredFromInvalid: true }
  }

  const sessionIds = new Set(sessions.map((session) => session.sessionId))
  const eventIds = new Set<string>()
  const events = value.flatMap((candidate): LearningActivityEvent[] => {
    if (
      !isLearningActivityEvent(candidate, sessionIds)
      || eventIds.has(candidate.eventId)
    ) return []
    eventIds.add(candidate.eventId)
    return [candidate]
  }).sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  )

  return {
    events,
    recoveredFromInvalid: events.length !== value.length,
  }
}

export function readLearningActivity(sessions: TrainingSession[]) {
  try {
    return parseLearningActivity(
      Taro.getStorageSync<unknown>(LEARNING_ACTIVITY_STORAGE_KEY),
      sessions,
    )
  } catch {
    return { events: [] as LearningActivityEvent[], recoveredFromInvalid: true }
  }
}

export function writeLearningActivity(events: LearningActivityEvent[]) {
  try {
    Taro.setStorageSync(LEARNING_ACTIVITY_STORAGE_KEY, events)
    return true
  } catch {
    return false
  }
}

export function syncLearningActivity(
  sessions: TrainingSession[],
  progressBySessionId: Record<string, TrainingProgress>,
) {
  const stored = readLearningActivity(sessions)
  const backfilled = backfillTrainingActivity(
    stored.events,
    sessions,
    progressBySessionId,
  )
  const shouldWrite = stored.recoveredFromInvalid || backfilled.changed
  return {
    events: backfilled.events,
    recoveredFromInvalid: stored.recoveredFromInvalid,
    writeFailed: shouldWrite && !writeLearningActivity(backfilled.events),
  }
}

export function recordLearningActivity(
  sessions: TrainingSession[],
  event: LearningActivityEvent,
) {
  const stored = readLearningActivity(sessions)
  const events = mergeLearningActivityEvent(stored.events, event)
  const changed = events !== stored.events
  const shouldWrite = stored.recoveredFromInvalid || changed
  return {
    events,
    changed,
    recoveredFromInvalid: stored.recoveredFromInvalid,
    writeFailed: shouldWrite && !writeLearningActivity(events),
  }
}
