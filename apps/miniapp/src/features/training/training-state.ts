import type {
  PracticeCard,
  TrainingSession,
} from '@microly/content-schema'

import {
  evaluatePractice,
  type PracticeEvaluationItem,
} from './practice-evaluation'

export type TrainingStatus = 'not_started' | 'in_progress' | 'completed'

export interface TrainingProgress {
  sessionId: string
  contentVersion: number
  attemptId: string
  status: TrainingStatus
  currentCardIndex: number
  selectedOptionId: string | null
  choiceConfirmed: boolean
  otherFeedbackExpanded: boolean
  practiceText: string
  practiceEvaluation: PracticeEvaluationItem[] | null
  practiceSkipped: boolean
  startedAt: string | null
  updatedAt: string
  completedAt: string | null
}

export type TrainingAction =
  | { type: 'START' }
  | { type: 'SELECT_OPTION'; optionId: string }
  | { type: 'CONFIRM_CHOICE' }
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'TOGGLE_OTHER_FEEDBACK' }
  | { type: 'UPDATE_PRACTICE'; text: string }
  | { type: 'SUBMIT_PRACTICE' }
  | { type: 'SKIP_PRACTICE' }
  | { type: 'COMPLETE' }
  | { type: 'RESET' }

function nowIso(now?: string) {
  return now ?? new Date().toISOString()
}

export function createInitialProgress(
  session: TrainingSession,
  now?: string,
): TrainingProgress {
  const timestamp = nowIso(now)
  return {
    sessionId: session.sessionId,
    contentVersion: session.contentVersion,
    attemptId: `attempt:${session.sessionId}:${timestamp}`,
    status: 'not_started',
    currentCardIndex: 0,
    selectedOptionId: null,
    choiceConfirmed: false,
    otherFeedbackExpanded: false,
    practiceText: '',
    practiceEvaluation: null,
    practiceSkipped: false,
    startedAt: null,
    updatedAt: timestamp,
    completedAt: null,
  }
}

function withUpdatedAt(progress: TrainingProgress, now?: string) {
  return {
    ...progress,
    updatedAt: nowIso(now),
  }
}

export function transitionTraining(
  progress: TrainingProgress,
  session: TrainingSession,
  action: TrainingAction,
  now?: string,
): TrainingProgress {
  if (action.type === 'RESET') {
    return createInitialProgress(session, now)
  }

  if (action.type === 'START') {
    if (progress.status !== 'not_started') {
      return progress
    }

    const timestamp = nowIso(now)
    return {
      ...progress,
      status: 'in_progress',
      startedAt: timestamp,
      updatedAt: timestamp,
    }
  }

  if (progress.status !== 'in_progress') {
    return progress
  }

  const card = session.cards[progress.currentCardIndex]
  if (!card) {
    return progress
  }

  switch (action.type) {
    case 'PREVIOUS': {
      if (progress.currentCardIndex <= 0 || card.type === 'completion') {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        currentCardIndex: progress.currentCardIndex - 1,
      }, now)
    }
    case 'SELECT_OPTION': {
      if (card.type !== 'choice' || progress.choiceConfirmed) {
        return progress
      }

      const optionExists = card.options.some(
        (option) => option.id === action.optionId,
      )
      if (!optionExists) {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        selectedOptionId: action.optionId,
      }, now)
    }
    case 'CONFIRM_CHOICE': {
      if (
        card.type !== 'choice'
        || progress.choiceConfirmed
        || !progress.selectedOptionId
      ) {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        choiceConfirmed: true,
        currentCardIndex: Math.min(
          progress.currentCardIndex + 1,
          session.cards.length - 1,
        ),
      }, now)
    }
    case 'NEXT': {
      const canAdvance =
        card.type === 'scenario'
        || (card.type === 'choice' && progress.choiceConfirmed)
        || card.type === 'feedback'
        || card.type === 'principle'

      if (!canAdvance) {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        currentCardIndex: Math.min(
          progress.currentCardIndex + 1,
          session.cards.length - 1,
        ),
      }, now)
    }
    case 'TOGGLE_OTHER_FEEDBACK': {
      if (card.type !== 'feedback') {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        otherFeedbackExpanded: !progress.otherFeedbackExpanded,
      }, now)
    }
    case 'UPDATE_PRACTICE': {
      if (card.type !== 'practice') {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        practiceText: action.text.slice(0, card.maxLength),
        practiceEvaluation: null,
        practiceSkipped: false,
      }, now)
    }
    case 'SUBMIT_PRACTICE': {
      if (
        card.type !== 'practice'
        || progress.practiceText.trim().length < card.minLength
      ) {
        return progress
      }

      return withUpdatedAt({
        ...progress,
        practiceEvaluation: evaluatePractice(progress.practiceText, card),
        practiceSkipped: false,
      }, now)
    }
    case 'SKIP_PRACTICE': {
      if (card.type !== 'practice') return progress
      return withUpdatedAt({ ...progress, practiceEvaluation: null, practiceSkipped: true }, now)
    }
    case 'COMPLETE': {
      if (card.type !== 'practice' || (!progress.practiceEvaluation && !progress.practiceSkipped)) {
        return progress
      }

      const timestamp = nowIso(now)
      return {
        ...progress,
        status: 'completed',
        currentCardIndex: session.cards.length - 1,
        updatedAt: timestamp,
        completedAt: timestamp,
      }
    }
    default:
      return progress
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEvaluation(value: unknown): value is PracticeEvaluationItem[] {
  return Array.isArray(value) && value.every((item) => {
    if (!isRecord(item)) {
      return false
    }

    return (
      typeof item.dimensionId === 'string'
      && (item.status === 'detected' || item.status === 'missing')
      && Array.isArray(item.matchedKeywords)
      && item.matchedKeywords.every((keyword) => typeof keyword === 'string')
    )
  })
}

export interface ParsedTrainingProgress {
  progress: TrainingProgress
  recoveredFromInvalid: boolean
}

export function parseTrainingProgress(
  value: unknown,
  session: TrainingSession,
): ParsedTrainingProgress {
  const fallback = createInitialProgress(session)
  if (!isRecord(value)) {
    return {
      progress: fallback,
      recoveredFromInvalid: value !== undefined && value !== '',
    }
  }

  const statusIsValid =
    value.status === 'not_started'
    || value.status === 'in_progress'
    || value.status === 'completed'
  const currentCardIndexIsValid =
    typeof value.currentCardIndex === 'number'
    && Number.isInteger(value.currentCardIndex)
    && value.currentCardIndex >= 0
    && value.currentCardIndex < session.cards.length
  const selectedOptionIsValid =
    value.selectedOptionId === null
    || typeof value.selectedOptionId === 'string'
  const evaluationIsValid =
    value.practiceEvaluation === null
    || isEvaluation(value.practiceEvaluation)

  const isValid =
    value.sessionId === session.sessionId
    && value.contentVersion === session.contentVersion
    && typeof value.attemptId === 'string'
    && value.attemptId.length > 0
    && statusIsValid
    && currentCardIndexIsValid
    && selectedOptionIsValid
    && typeof value.choiceConfirmed === 'boolean'
    && typeof value.otherFeedbackExpanded === 'boolean'
    && typeof value.practiceText === 'string'
    && value.practiceText.length <= 200
    && evaluationIsValid
    && typeof value.practiceSkipped === 'boolean'
    && (value.startedAt === null || typeof value.startedAt === 'string')
    && typeof value.updatedAt === 'string'
    && (value.completedAt === null || typeof value.completedAt === 'string')

  if (!isValid) {
    return {
      progress: fallback,
      recoveredFromInvalid: true,
    }
  }

  if (value.choiceConfirmed && !value.selectedOptionId) {
    return {
      progress: fallback,
      recoveredFromInvalid: true,
    }
  }

  const choiceCard = session.cards.find(
    (card) => card.type === 'choice',
  )
  const selectedOptionExists =
    value.selectedOptionId === null
    || choiceCard?.options.some((option) => option.id === value.selectedOptionId)

  if (!selectedOptionExists) {
    return {
      progress: fallback,
      recoveredFromInvalid: true,
    }
  }

  if (
    typeof value.currentCardIndex === 'number'
    && value.currentCardIndex >= 2
    && (!value.choiceConfirmed || !value.selectedOptionId)
  ) {
    return {
      progress: fallback,
      recoveredFromInvalid: true,
    }
  }

  if (
    value.status === 'completed'
    && (
      value.currentCardIndex !== session.cards.length - 1
      || typeof value.completedAt !== 'string'
      || (value.practiceEvaluation === null && !value.practiceSkipped)
    )
  ) {
    return {
      progress: fallback,
      recoveredFromInvalid: true,
    }
  }

  return {
    progress: value as unknown as TrainingProgress,
    recoveredFromInvalid: false,
  }
}

export function getPracticeCard(session: TrainingSession): PracticeCard {
  const practiceCard = session.cards.find(
    (card): card is PracticeCard => card.type === 'practice',
  )

  if (!practiceCard) {
    throw new Error('训练内容缺少主动表达卡')
  }

  return practiceCard
}
