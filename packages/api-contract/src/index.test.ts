import { describe, expect, it } from 'vitest'

import { AnalyticsBatchRequestSchema, TrainingCompletionSchema } from './index'

const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  name: 'training_complete',
  occurredAt: '2026-07-23T10:00:00.000Z',
  properties: {
    sessionId: 'boundary-decline-001',
    contentVersion: 1,
    durationMs: 120000,
    practiceUsed: true,
  },
} as const

describe('API contract', () => {
  it('限制埋点批次为 50 条', () => {
    expect(AnalyticsBatchRequestSchema.safeParse({ events: Array(50).fill(event) }).success).toBe(true)
    expect(AnalyticsBatchRequestSchema.safeParse({ events: Array(51).fill(event) }).success).toBe(false)
  })

  it('拒绝埋点未知字段和主动表达原文', () => {
    expect(AnalyticsBatchRequestSchema.safeParse({
      events: [{
        ...event,
        properties: { ...event.properties, practiceText: '不应上传的原文' },
      }],
    }).success).toBe(false)
  })

  it('拒绝完成时间早于开始时间', () => {
    expect(TrainingCompletionSchema.safeParse({
      syncId: 'completion:test',
      sessionId: 'boundary-decline-001',
      contentVersion: 1,
      selectedOptionId: 'option-a',
      startedAt: '2026-07-23T11:00:00.000Z',
      completedAt: '2026-07-23T10:00:00.000Z',
    }).success).toBe(false)
  })
})
