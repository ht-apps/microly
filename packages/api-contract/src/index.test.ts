import { describe, expect, it } from 'vitest'

import {
  AdminContentIndexResponseSchema,
  AdminDraftValidationResponseSchema,
  AdminFeedbackListResponseSchema,
  AdminFeedbackUpdateRequestSchema,
  AdminMetricsResponseSchema,
  AdminPublishRequestSchema,
  AnalyticsBatchRequestSchema,
  SyncRequestSchema,
  TrainingCompletionSchema,
} from './index'

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

  it('同步进度不接受主动表达或本地点评', () => {
    expect(SyncRequestSchema.safeParse({
      requestId: '22222222-2222-4222-8222-222222222222',
      favorites: [], reviews: [], activities: [],
      progress: [{
        sessionId: 'boundary-decline-001', contentVersion: 1,
        attemptId: 'attempt-1', status: 'in_progress', currentCardIndex: 2,
        selectedOptionId: 'option-a', choiceConfirmed: true,
        startedAt: '2026-07-23T10:00:00.000Z', updatedAt: '2026-07-23T10:01:00.000Z',
        completedAt: null, practiceText: '不应上传', practiceEvaluation: [],
      }],
    }).success).toBe(false)
  })

  it('严格校验管理写入与反馈状态', () => {
    expect(AdminPublishRequestSchema.safeParse({ revision: 2, reason: '修正训练反馈' }).success).toBe(true)
    expect(AdminPublishRequestSchema.safeParse({ revision: 2, reason: 'ok', token: 'secret' }).success).toBe(false)
    expect(AdminFeedbackUpdateRequestSchema.safeParse({ status: 'resolved', internalNote: '已处理' }).success).toBe(true)
    expect(AdminFeedbackUpdateRequestSchema.safeParse({ status: 'unknown' }).success).toBe(false)
  })

  it('指标响应不包含账号或原始事件', () => {
    const value = {
      data: {
        window: '7d', generatedAt: '2026-07-23T10:00:00.000Z',
        funnel: ['app_open', 'onboarding_view', 'training_start', 'option_select', 'training_complete', 'wechat_login_success'].map((name, index) => ({ name, accounts: 6 - index, conversionRate: index ? 0.8 : null })),
        daily: [], sessions: [],
        feedback: { total: 0, byStatus: { new: 0, in_progress: 0, resolved: 0, dismissed: 0 }, byCategory: {} },
      },
    }
    expect(AdminMetricsResponseSchema.safeParse(value).success).toBe(true)
    expect(AdminMetricsResponseSchema.safeParse({ ...value, data: { ...value.data, accountId: '11111111-1111-4111-8111-111111111111' } }).success).toBe(false)
  })

  it('严格校验后台列表和草稿校验响应', () => {
    expect(AdminContentIndexResponseSchema.safeParse({ data: {
      currentVersion: 1, releases: [], drafts: [],
    } }).success).toBe(true)
    expect(AdminContentIndexResponseSchema.safeParse({ data: {
      currentVersion: 1, releases: [], drafts: [], token: 'never-return-this',
    } }).success).toBe(false)
    expect(AdminDraftValidationResponseSchema.safeParse({ data: {
      valid: false,
      issues: [{ path: 'sessions.example', message: '训练无效', severity: 'error' }],
      normalizedBundle: null,
    } }).success).toBe(true)
    expect(AdminFeedbackListResponseSchema.safeParse({ data: {
      items: [], total: 0, page: 1, pageSize: 20,
    } }).success).toBe(true)
  })
})
