import {
  AiEvaluationListResponseSchema,
  AiEvaluationResponseSchema,
  AiStatusResponseSchema,
  type AiEvaluation,
} from '@microly/api-contract'
import type { PracticeCard, TrainingSession } from '@microly/content-schema'

import { authorizedRequest, readStoredAuth } from '../network/guest-auth'
import { createSecureUuid } from '../network/identifier'
import { isNetworkEnabled } from '../network/network-config'
import type { TrainingProgress } from '../training/training-state'
import { resolveAiAccessState } from './ai-access'
import { readCachedAiEvaluations, writeCachedAiEvaluations } from './ai-history-storage'
import { captureClientError } from '../diagnostics/client-errors'

export function readAiAccessState() {
  return resolveAiAccessState({
    networkEnabled: isNetworkEnabled(),
    authType: readStoredAuth()?.authType ?? 'guest',
  })
}

export function canUseAi() {
  return readAiAccessState() === 'ready'
}

export async function readAiStatus() {
  const response = await authorizedRequest<unknown>({ path: '/v1/ai/status', method: 'GET' })
  const parsed = AiStatusResponseSchema.safeParse(response?.data)
  return response?.statusCode === 200 && parsed.success ? parsed.data.data : null
}

export async function submitAiEvaluation(session: TrainingSession, card: PracticeCard, progress: TrainingProgress) {
  const response = await authorizedRequest<unknown>({
    path: '/v1/ai/evaluations',
    method: 'POST',
    data: {
      requestId: await createSecureUuid(),
      attemptId: progress.attemptId,
      sessionId: session.sessionId,
      contentVersion: session.contentVersion,
      practiceCardId: card.id,
      practiceText: progress.practiceText,
    },
  })
  const parsed = AiEvaluationResponseSchema.safeParse(response?.data)
  if (response && response.statusCode >= 500) captureClientError('ai', null, { severity: 'warning', errorCode: `http_${response.statusCode}`, contentVersion: session.contentVersion })
  else if (response?.statusCode === 200 && !parsed.success) captureClientError('ai', null, { errorCode: 'invalid_ai_response', contentVersion: session.contentVersion })
  return {
    evaluation: parsed.success ? parsed.data.data : null,
    statusCode: response?.statusCode ?? 0,
    errorCode: (response?.data as { error?: { code?: string } } | undefined)?.error?.code ?? null,
  }
}

export async function getAiEvaluation(id: string): Promise<AiEvaluation | null> {
  const response = await authorizedRequest<unknown>({ path: `/v1/ai/evaluations/${encodeURIComponent(id)}`, method: 'GET' })
  const parsed = AiEvaluationResponseSchema.safeParse(response?.data)
  return parsed.success ? parsed.data.data : null
}

export async function listAiEvaluations(sessionId?: string): Promise<AiEvaluation[]> {
  const items: AiEvaluation[] = []
  let cursor: string | null = null
  for (let page = 0; page < 2; page += 1) {
    const query = [`limit=50`, sessionId ? `sessionId=${encodeURIComponent(sessionId)}` : '', cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&')
    const response = await authorizedRequest<unknown>({ path: `/v1/ai/evaluations?${query}`, method: 'GET' })
    const parsed = AiEvaluationListResponseSchema.safeParse(response?.data)
    if (!parsed.success) return sessionId ? readCachedAiEvaluations().filter((item) => item.sessionId === sessionId) : readCachedAiEvaluations()
    items.push(...parsed.data.data.items)
    cursor = parsed.data.data.nextCursor
    if (!cursor) break
  }
  const cached = writeCachedAiEvaluations(items)
  return sessionId ? cached.filter((item) => item.sessionId === sessionId) : cached
}

export async function rateAiEvaluation(id: string, helpful: boolean, reason: string | null = null) {
  const response = await authorizedRequest<unknown>({
    path: `/v1/ai/evaluations/${encodeURIComponent(id)}/rating`, method: 'PUT', data: { helpful, reason },
  })
  const parsed = AiEvaluationResponseSchema.safeParse(response?.data)
  return parsed.success ? parsed.data.data : null
}

export async function cancelAiEvaluation(id: string) {
  const response = await authorizedRequest<unknown>({ path: `/v1/ai/evaluations/${encodeURIComponent(id)}/cancel`, method: 'POST' })
  const parsed = AiEvaluationResponseSchema.safeParse(response?.data)
  return parsed.success ? parsed.data.data : null
}
