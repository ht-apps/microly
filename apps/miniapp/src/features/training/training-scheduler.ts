import type { TrainingCatalog, TrainingSession } from '@microly/content-schema'

import type { TrainingContentChapter } from '../../data/training-content'
import type { TrainingProgress } from './training-state'

export type CourseItemStatus =
  | 'unavailable'
  | 'locked'
  | 'not_started'
  | 'in_progress'
  | 'completed'

export type CourseChapterStatus =
  | 'unavailable'
  | 'locked'
  | 'not_started'
  | 'in_progress'
  | 'completed'

export interface CourseItem {
  catalogId: string
  sessionId: string
  session: TrainingSession | null
  status: CourseItemStatus
  progress: TrainingProgress | null
  error: string | null
}

export interface CourseChapterOverview {
  catalogId: string
  catalog: TrainingCatalog | null
  status: CourseChapterStatus
  items: CourseItem[]
  completedCount: number
  availableCount: number
  error: string | null
}

export interface CourseOverview {
  chapters: CourseChapterOverview[]
  items: CourseItem[]
  activeItem: CourseItem | null
  activeChapter: CourseChapterOverview | null
  completedCount: number
  availableCount: number
  allCompleted: boolean
}

export function createCourseOverview(
  contentChapters: TrainingContentChapter[],
  progressBySessionId: Record<string, TrainingProgress>,
): CourseOverview {
  let previousAvailableCompleted = true

  const chapters = contentChapters.map((chapter): CourseChapterOverview => {
    const items = chapter.entries.map((entry): CourseItem => {
      if (!entry.session) {
        return {
          catalogId: chapter.catalogId,
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

      if (progress?.status !== 'completed') previousAvailableCompleted = false

      return {
        catalogId: chapter.catalogId,
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
    let status: CourseChapterStatus

    if (!chapter.catalog || availableItems.length === 0) {
      status = 'unavailable'
    } else if (completedCount === availableItems.length) {
      status = 'completed'
    } else if (availableItems.some((item) => item.status === 'in_progress')) {
      status = 'in_progress'
    } else if (availableItems.some((item) => item.status === 'not_started')) {
      status = 'not_started'
    } else {
      status = 'locked'
    }

    return {
      catalogId: chapter.catalogId,
      catalog: chapter.catalog,
      status,
      items,
      completedCount,
      availableCount: availableItems.length,
      error: chapter.error,
    }
  })

  const items = chapters.flatMap((chapter) => chapter.items)
  const availableItems = items.filter((item) => item.session)
  const completedCount = availableItems.filter(
    (item) => item.status === 'completed',
  ).length
  const activeItem = items.find((item) => item.status === 'in_progress')
    ?? items.find((item) => item.status === 'not_started')
    ?? null
  const activeChapter = activeItem
    ? chapters.find((chapter) => chapter.catalogId === activeItem.catalogId) ?? null
    : null

  return {
    chapters,
    items,
    activeItem,
    activeChapter,
    completedCount,
    availableCount: availableItems.length,
    allCompleted:
      availableItems.length > 0 && completedCount === availableItems.length,
  }
}
