import type { TrainingSession } from '@microly/content-schema'

import type { TrainingContentEntry } from '../../data/training-content'
import type { TrainingProgress } from './training-state'

export type CourseItemStatus =
  | 'unavailable'
  | 'locked'
  | 'not_started'
  | 'in_progress'
  | 'completed'

export interface CourseItem {
  sessionId: string
  session: TrainingSession | null
  status: CourseItemStatus
  progress: TrainingProgress | null
  error: string | null
}

export interface CourseOverview {
  items: CourseItem[]
  activeItem: CourseItem | null
  completedCount: number
  availableCount: number
  allCompleted: boolean
}

export function createCourseOverview(
  entries: TrainingContentEntry[],
  progressBySessionId: Record<string, TrainingProgress>,
): CourseOverview {
  let previousAvailableCompleted = true

  const items = entries.map((entry): CourseItem => {
    if (!entry.session) {
      return {
        sessionId: entry.sessionId,
        session: null,
        status: 'unavailable',
        progress: null,
        error: entry.error,
      }
    }

    const progress = progressBySessionId[entry.sessionId] ?? null
    let status: CourseItemStatus

    if (progress?.status === 'completed') {
      status = 'completed'
    } else if (progress?.status === 'in_progress') {
      status = 'in_progress'
    } else if (previousAvailableCompleted) {
      status = 'not_started'
    } else {
      status = 'locked'
    }

    if (progress?.status !== 'completed') {
      previousAvailableCompleted = false
    }

    return {
      sessionId: entry.sessionId,
      session: entry.session,
      status,
      progress,
      error: null,
    }
  })

  const availableItems = items.filter((item) => item.session)
  const completedCount = availableItems.filter(
    (item) => item.status === 'completed',
  ).length
  const activeItem = items.find((item) => item.status === 'in_progress')
    ?? items.find((item) => item.status === 'not_started')
    ?? null

  return {
    items,
    activeItem,
    completedCount,
    availableCount: availableItems.length,
    allCompleted:
      availableItems.length > 0 && completedCount === availableItems.length,
  }
}
