import type { TrainingSession } from '@microly/content-schema'
import Taro from '@tarojs/taro'

import { currentTrainingContentBundle } from '../../data/training-content'
import type { TrainingProgress } from '../training/training-state'
import { trackEvent } from './analytics-client'

const STARTED_KEY = 'microly:analytics:started-attempts:v1'
const ACTIVE_KEY = 'microly:analytics:active-attempts:v1'
const SEGMENT_CAP_MS = 10 * 60 * 1000
const TOTAL_CAP_MS = 60 * 60 * 1000

export type TrainingEntry = 'onboarding' | 'today' | 'course' | 'favorites' | 'weekly_report' | 'challenge' | 'restart' | 'direct'

interface ActiveAttempt {
  elapsedMs: number
  activeSince: number | null
}

function readStarted() {
  try {
    const value = Taro.getStorageSync<unknown>(STARTED_KEY)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-200) : []
  } catch { return [] }
}

function readActive(): Record<string, ActiveAttempt> {
  try {
    const value = Taro.getStorageSync<unknown>(ACTIVE_KEY)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, ActiveAttempt>
  } catch { return {} }
}

function writeActive(value: Record<string, ActiveAttempt>) {
  try { Taro.setStorageSync(ACTIVE_KEY, value) } catch { /* Analytics never blocks learning. */ }
}

export function trackTrainingStart(session: TrainingSession, progress: TrainingProgress, entry: TrainingEntry) {
  const started = readStarted()
  if (started.includes(progress.attemptId)) return false
  trackEvent('training_start', {
    attemptId: progress.attemptId,
    sessionId: session.sessionId,
    releaseVersion: currentTrainingContentBundle.releaseVersion,
    contentVersion: session.contentVersion,
    entry,
  })
  try { Taro.setStorageSync(STARTED_KEY, [...started, progress.attemptId].slice(-200)) } catch { /* Ignore. */ }
  return true
}

export function beginActiveTraining(attemptId: string, now = Date.now()) {
  const items = readActive()
  const current = items[attemptId] ?? { elapsedMs: 0, activeSince: null }
  if (current.activeSince === null) items[attemptId] = { ...current, activeSince: now }
  writeActive(items)
}

export function pauseActiveTraining(attemptId: string, now = Date.now()) {
  const items = readActive()
  const current = items[attemptId]
  if (!current || current.activeSince === null) return current?.elapsedMs ?? 0
  const segment = Math.max(0, Math.min(SEGMENT_CAP_MS, now - current.activeSince))
  const elapsedMs = Math.min(TOTAL_CAP_MS, current.elapsedMs + segment)
  items[attemptId] = { elapsedMs, activeSince: null }
  writeActive(items)
  return elapsedMs
}

export function finishActiveTraining(attemptId: string, now = Date.now()) {
  const elapsedMs = pauseActiveTraining(attemptId, now)
  const items = readActive()
  delete items[attemptId]
  writeActive(items)
  return elapsedMs
}
