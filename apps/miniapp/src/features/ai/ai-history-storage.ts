import type { AiEvaluation } from '@microly/api-contract'
import Taro from '@tarojs/taro'

const STORAGE_KEY = 'microly:ai-evaluation-history:v1'
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000

export function readCachedAiEvaluations(now = Date.now()): AiEvaluation[] {
  try {
    const value = Taro.getStorageSync<unknown>(STORAGE_KEY)
    if (!Array.isArray(value)) return []
    return (value as AiEvaluation[]).filter((item) => item && typeof item.createdAt === 'string' && Date.parse(item.createdAt) >= now - MAX_AGE_MS)
  } catch { return [] }
}

export function writeCachedAiEvaluations(items: AiEvaluation[], now = Date.now()) {
  try {
    const byId = new Map([...readCachedAiEvaluations(now), ...items].map((item) => [item.id, item]))
    const retained = [...byId.values()].filter((item) => Date.parse(item.createdAt) >= now - MAX_AGE_MS).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    Taro.setStorageSync(STORAGE_KEY, retained)
    return retained
  } catch { return readCachedAiEvaluations(now) }
}
