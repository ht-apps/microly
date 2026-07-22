import Taro from '@tarojs/taro'
import type { TrainingSession } from '@microly/content-schema'

import {
  parseTrainingProgress,
  type ParsedTrainingProgress,
  type TrainingProgress,
} from './training-state'

export const TRAINING_STORAGE_KEY =
  'microly:training:boundary-decline-001:v1'

export function readTrainingProgress(
  session: TrainingSession,
): ParsedTrainingProgress {
  try {
    const storedValue = Taro.getStorageSync<unknown>(TRAINING_STORAGE_KEY)
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
    Taro.setStorageSync(TRAINING_STORAGE_KEY, progress)
    return true
  } catch {
    return false
  }
}

export function clearTrainingProgress() {
  try {
    Taro.removeStorageSync(TRAINING_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
