import { describe, expect, it } from 'vitest'

import {
  AdminContentIndexResponseSchema,
  AdminContentReleaseSnapshotResponseSchema,
  AdminDraftDeleteResponseSchema,
  AdminDraftStateRequestSchema,
  AdminDraftValidationResponseSchema,
  AdminFeedbackListResponseSchema,
  AdminFeedbackUpdateRequestSchema,
  AdminMetricsResponseSchema,
  AdminLearningQualityResponseSchema,
  AdminReviewVariantGenerateResponseSchema,
  AdminOutlineGenerateRequestSchema,
  AdminContentGenerationJobResponseSchema,
  AdminContentReviewUpdateRequestSchema,
  AiEvaluationCreateRequestSchema,
  AiEvaluationResultSchema,
  AdminPublishRequestSchema,
  AdminPublishResponseSchema,
  AnalyticsBatchRequestSchema,
  ClientErrorBatchRequestSchema,
  AdminOperationsResponseSchema,
  SyncRequestSchema,
  TrainingCompletionSchema,
  ContentQualityIssueUpdateRequestSchema,
  RuntimeConfigResponseSchema,
  AdminRuntimeConfigUpdateRequestSchema,
  AdminDeploymentListResponseSchema,
  AdminBackupListResponseSchema,
} from './index'

const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  visitId: '21111111-1111-4111-8111-111111111111',
  name: 'training_complete',
  occurredAt: '2026-07-23T10:00:00.000Z',
  localDateKey: '2026-07-23',
  timezoneOffsetMinutes: -480,
  properties: {
    attemptId: 'attempt:boundary-decline-001:test',
    sessionId: 'boundary-decline-001',
    releaseVersion: 1,
    contentVersion: 1,
    durationMs: 120000,
    practiceUsed: true,
  },
} as const

describe('API contract', () => {
  it('严格校验运行配置、部署和备份响应', () => {
    const runtime = { data: {
      revision: 1, environment: 'production', apiVersion: '1.0.0', minimumSupportedVersion: '1.0.0',
      maintenance: { active: false, message: null },
      features: { wechatLogin: true, accountSync: true, aiEvaluation: false, feedback: true },
      serverTime: '2026-07-24T10:00:00.000Z',
    } }
    expect(RuntimeConfigResponseSchema.safeParse(runtime).success).toBe(true)
    expect(RuntimeConfigResponseSchema.safeParse({ data: { ...runtime.data, token: 'secret' } }).success).toBe(false)
    expect(AdminRuntimeConfigUpdateRequestSchema.safeParse({ ...runtime.data, reason: '封测维护', environment: undefined, apiVersion: undefined, serverTime: undefined }).success).toBe(false)
    expect(AdminRuntimeConfigUpdateRequestSchema.safeParse({
      revision: 1, minimumSupportedVersion: '1.0.0', maintenance: { active: true, message: '正在维护' },
      features: runtime.data.features, reason: '执行数据库维护',
    }).success).toBe(true)
    expect(AdminDeploymentListResponseSchema.safeParse({ data: { items: [] } }).success).toBe(true)
    expect(AdminBackupListResponseSchema.safeParse({ data: { items: [] } }).success).toBe(true)
  })
  it('严格校验内容生产任务和训练审核', () => {
    const outlineRequest = {
      requestId: '41111111-1111-4111-8111-111111111111', revision: 2, count: 2,
      difficulties: ['L1', 'L2'], brief: '覆盖坏消息更新和依赖决策，不使用真实公司信息。',
    }
    expect(AdminOutlineGenerateRequestSchema.safeParse(outlineRequest).success).toBe(true)
    expect(AdminOutlineGenerateRequestSchema.safeParse({ ...outlineRequest, practiceText: '不应出现' }).success).toBe(false)
    expect(AdminContentReviewUpdateRequestSchema.safeParse({
      revision: 2, contentDigest: 'a'.repeat(64), operatorLabel: '内容运营甲', reviewerLabel: null, note: null,
      checklist: { objectiveAligned: true, optionQuality: true, feedbackBalanced: true, principleConsistent: true, practiceRubric: true, safetyAndPrivacy: true, mobilePreview: true },
    }).success).toBe(true)
    expect(AdminContentReviewUpdateRequestSchema.safeParse({
      revision: 2, contentDigest: 'a'.repeat(64), operatorLabel: '内容运营甲',
      checklist: { objectiveAligned: true, optionQuality: true, feedbackBalanced: true, principleConsistent: true, practiceRubric: true, safetyAndPrivacy: true, mobilePreview: false },
    }).success).toBe(false)
    expect(AdminContentGenerationJobResponseSchema.safeParse({ data: {
      id: '51111111-1111-4111-8111-111111111111', requestId: outlineRequest.requestId,
      draftId: '61111111-1111-4111-8111-111111111111', catalogId: 'clear-reporting', draftRevision: 2,
      operation: 'session_outlines', status: 'queued', requestedCount: 2,
      parameters: { difficulties: ['L1', 'L2'], brief: '生成匿名职场训练大纲。', outlineJobId: null, outlineIds: [] },
      outlines: [], candidates: [], insertedCandidateIds: [], model: { modelId: 'deepseek-v4-flash', configRevision: 1, promptVersion: 'session-outline-v1' },
      promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0,
      latencyMs: null, formatRetries: 0, failureCode: null,
      createdAt: '2026-07-24T10:00:00.000Z', startedAt: null, completedAt: null,
    } }).success).toBe(true)
  })

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

  it('错误报告只接受受限运行上下文', () => {
    const report = {
      reportId: '71111111-1111-4111-8111-111111111111', fingerprint: 'a'.repeat(64),
      category: 'runtime', severity: 'error', page: '/pages/training/index', appVersion: '1.0.0',
      contentVersion: 2, networkType: 'wifi', errorCode: 'typeerror', stackDigest: null,
      occurredAt: '2026-07-23T10:00:00.000Z',
    }
    expect(ClientErrorBatchRequestSchema.safeParse({ reports: [report] }).success).toBe(true)
    expect(ClientErrorBatchRequestSchema.safeParse({ reports: [{ ...report, practiceText: '绝不能上传的原文' }] }).success).toBe(false)
    expect(ClientErrorBatchRequestSchema.safeParse({ reports: Array(21).fill(report) }).success).toBe(false)
  })

  it('运行保障响应不允许账号明细或错误正文', () => {
    const value = { data: {
      window: '24h', generatedAt: '2026-07-23T10:00:00.000Z',
      services: { process: 'ok', database: 'ok', ai: 'disabled', content: 'ok', currentContentVersion: 2, activeModelId: null },
      summary: { total: 1, unresolved: 1, affectedAccounts: 1, pendingFeedback: 2, level: 'normal' },
      api: { requests: 10, errorRate: 0, latencyP50: 12, latencyP95: 30 },
      daily: [], pages: [], versions: [], alerts: [],
      issues: [{ fingerprint: 'b'.repeat(64), category: 'runtime', severity: 'error', page: '/pages/training/index', errorCode: 'typeerror', count: 1, affectedAccounts: 1, firstSeenAt: '2026-07-23T10:00:00.000Z', lastSeenAt: '2026-07-23T10:00:00.000Z', status: 'new', internalNote: null }],
    } }
    expect(AdminOperationsResponseSchema.safeParse(value).success).toBe(true)
    expect(AdminOperationsResponseSchema.safeParse({ ...value, data: { ...value.data, accountId: '11111111-1111-4111-8111-111111111111' } }).success).toBe(false)
    expect(AdminOperationsResponseSchema.safeParse({ ...value, data: { ...value.data, issues: [{ ...value.data.issues[0], message: '原始错误正文' }] } }).success).toBe(false)
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
    const published = { data: { releaseVersion: 2, checksum: 'a'.repeat(64) } }
    expect(AdminPublishResponseSchema.safeParse(published).success).toBe(true)
    expect(AdminPublishResponseSchema.safeParse({ data: { ...published.data, bundle: {} } }).success).toBe(false)
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
        review: { originalAnswers: 0, variantAnswers: 0, originalCorrectRate: null, variantCorrectRate: null, weeklyReportViews: 0, weeklyReportActions: 0 },
      },
    }
    expect(AdminMetricsResponseSchema.safeParse(value).success).toBe(true)
    expect(AdminMetricsResponseSchema.safeParse({ ...value, data: { ...value.data, accountId: '11111111-1111-4111-8111-111111111111' } }).success).toBe(false)
  })

  it('严格校验学习质量聚合与问题处理', () => {
    const response = { data: {
      window: '30d', generatedAt: '2026-07-24T10:00:00.000Z', coverageStartedAt: null,
      selectedReleaseVersion: 2, currentReleaseVersion: 2,
      filters: { releases: [], catalogs: [], sessions: [] },
      summary: {
        firstOpenAccounts: 0, firstTrainingStartedAccounts: 0, firstTrainingStartRate: null,
        firstTrainingCompletedAccounts: 0, firstTrainingCompletionRate: null,
        d1EligibleAccounts: 0, d1RetainedAccounts: 0, d1RetentionRate: null,
        sevenDayEligibleAccounts: 0, sevenDayThreePracticeAccounts: 0, sevenDayThreePracticeRate: null,
        completedAttempts: 0, activePracticeRate: null, medianDurationMs: null,
        dueReviewOccurrences: 0, dueReviewCompleted: 0, dueReviewCompletionRate: null,
        welAccounts: 0, openIssueCount: 0,
      },
      retentionTrend: [], sessions: [], issues: [],
    } }
    expect(AdminLearningQualityResponseSchema.safeParse(response).success).toBe(true)
    expect(AdminLearningQualityResponseSchema.safeParse({
      data: { ...response.data, accountIds: ['不应返回账号明细'] },
    }).success).toBe(false)
    expect(ContentQualityIssueUpdateRequestSchema.safeParse({
      status: 'resolved', internalNote: '已修正并重新发布',
    }).success).toBe(true)
    expect(ContentQualityIssueUpdateRequestSchema.safeParse({
      status: 'dismissed', internalNote: '',
    }).success).toBe(false)
  })

  it('严格校验后台复习变体候选', () => {
    const candidate = {
      variantId: 'variant-one', title: '新的协作情景',
      context: '这是一个用于复习的全新职场协作情景，包含清楚的关系、目标、限制和需要作出的表达决定。',
      question: '你会如何回应？', prompt: '选择更合适的一句话',
      options: ['risky', 'not_recommended', 'recommended'].map((rating, index) => ({
        id: `variant-option-${index}`, text: `候选表达 ${index + 1}`, rating,
        feedback: { interpretation: '对方可能这样理解。', strength: '体现了部分信息。', risk: '仍有需要注意的风险。' },
      })),
    }
    expect(AdminReviewVariantGenerateResponseSchema.safeParse({ data: {
      candidates: [candidate], model: { modelId: 'deepseek-v4-flash', configRevision: 1, promptVersion: 'review-variant-v1' }, warnings: [],
    } }).success).toBe(true)
  })

  it('严格校验后台列表和草稿校验响应', () => {
    expect(AdminDraftStateRequestSchema.safeParse({ revision: 2 }).success).toBe(true)
    expect(AdminDraftStateRequestSchema.safeParse({ revision: 2, status: 'published' }).success).toBe(false)
    expect(AdminDraftDeleteResponseSchema.safeParse({ data: { id: '11111111-1111-4111-8111-111111111111' } }).success).toBe(true)
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

  it('发布历史预览拒绝无效内容快照', () => {
    expect(AdminContentReleaseSnapshotResponseSchema.safeParse({ data: {
      releaseVersion: 1,
      checksum: 'a'.repeat(64),
      createdFromVersion: null,
      releaseReason: '初始发布',
      publishedAt: '2026-07-23T10:00:00.000Z',
      sessionCount: 0,
      bundle: {},
    } }).success).toBe(false)
  })

  it('严格校验 AI 原文请求和结构化安全结果', () => {
    const request = {
      requestId: '33333333-3333-4333-8333-333333333333', attemptId: 'attempt:test',
      sessionId: 'boundary-decline-001', contentVersion: 1, practiceCardId: 'practice',
      practiceText: '今天无法全部完成，我可以先交付核心结论，明天补齐。',
    }
    expect(AiEvaluationCreateRequestSchema.safeParse(request).success).toBe(true)
    expect(AiEvaluationCreateRequestSchema.safeParse({ ...request, token: 'secret' }).success).toBe(false)
    const blocked = {
      mode: 'rule', rubricVersion: 'rubric-v1', dimensions: [{ dimensionId: 'goal', level: 'missing', reason: '请先修改输入。' }],
      summary: '输入包含敏感信息。', rewrite: null,
      safety: { allowed: false, reasonCode: 'company_secret' }, model: null,
    }
    expect(AiEvaluationResultSchema.safeParse(blocked).success).toBe(true)
    expect(AiEvaluationResultSchema.safeParse({ ...blocked, rewrite: '不应生成改写' }).success).toBe(false)
  })
})
