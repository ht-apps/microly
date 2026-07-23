import { createHash } from 'node:crypto'

import { trainingContentBundle } from '@microly/training-content'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from './app.js'
import { createDatabase } from './db/client.js'
import { migrateDatabase } from './db/migrate.js'
import { seedContent } from './db/seed.js'

const databaseUrl = process.env.DATABASE_URL ?? ''
if (!databaseUrl.includes('microly_test')) {
  throw new Error('集成测试只能连接 microly_test 数据库')
}

const database = createDatabase(databaseUrl)
const app = createApp({
  databaseUrl,
  admin: { token: 'admin-token-with-at-least-32-characters', origins: ['http://localhost:5173'] },
  wechat: { appId: 'wx-test', appSecret: 'test-secret', identityHashSecret: 'identity-secret-with-at-least-32-characters' },
  exchangeWechatCode: async (code) => ({ openid: code }),
})
let authorization = ''
let issuedToken = ''

beforeAll(async () => {
  await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrateDatabase(database)
  await migrateDatabase(database)
  await seedContent(database)
  await app.ready()
  const auth = await app.inject({
    method: 'POST',
    url: '/v1/auth/guest',
    payload: { installationId: '11111111-1111-4111-8111-111111111111' },
  })
  issuedToken = auth.json().data.token
  authorization = `Bearer ${issuedToken}`
})

afterAll(async () => {
  await app.close()
  await database.pool.end()
})

describe('network MVP API', () => {
  const adminAuthorization = 'Bearer admin-token-with-at-least-32-characters'

  it('将空 JSON 请求体报告为安全的 400 错误', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/content/drafts/11111111-1111-4111-8111-111111111111/validate',
      headers: { authorization: adminAuthorization, 'content-type': 'application/json' },
      payload: '',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: { code: 'invalid_request', message: '请求内容不符合接口约定。' } })
  })

  it('返回内容 ETag 并支持 304', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/content/current' })
    expect(first.statusCode).toBe(200)
    expect(first.json().data.bundle.releaseVersion).toBe(1)
    const second = await app.inject({
      method: 'GET',
      url: '/v1/content/current',
      headers: { 'if-none-match': first.headers.etag as string },
    })
    expect(second.statusCode).toBe(304)
  })

  it('对游客身份和完成提交保持幂等', async () => {
    const session = trainingContentBundle.sessions['boundary-decline-001']
    if (!session) throw new Error('缺少集成测试内容')
    const option = session.cards.find((card) => card.type === 'choice')?.options[0]
    const completedAt = new Date(Date.now() - 60_000).toISOString()
    const startedAt = new Date(Date.now() - 240_000).toISOString()
    const completion = {
      syncId: `completion:boundary-decline-001:v1:${completedAt}`,
      sessionId: session.sessionId,
      contentVersion: session.contentVersion,
      selectedOptionId: option?.id,
      startedAt,
      completedAt,
    }
    const first = await app.inject({
      method: 'POST', url: '/v1/training-completions', headers: { authorization }, payload: completion,
    })
    const repeated = await app.inject({
      method: 'POST', url: '/v1/training-completions', headers: { authorization }, payload: completion,
    })
    expect(first.statusCode).toBe(201)
    expect(repeated.statusCode).toBe(200)
    const listed = await app.inject({
      method: 'GET', url: '/v1/training-completions', headers: { authorization },
    })
    expect(listed.json().data).toHaveLength(1)
  })

  it('拒绝非法选项并对埋点去重', async () => {
    const completedAt = new Date(Date.now() - 60_000).toISOString()
    const startedAt = new Date(Date.now() - 240_000).toISOString()
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/training-completions',
      headers: { authorization },
      payload: {
        syncId: 'invalid-option',
        sessionId: 'boundary-decline-001',
        contentVersion: 1,
        selectedOptionId: 'missing-option',
        startedAt,
        completedAt,
      },
    })
    expect(invalid.statusCode).toBe(422)

    const analyticsEvent = {
      eventId: '22222222-2222-4222-8222-222222222222',
      name: 'app_open',
      occurredAt: '2026-07-23T10:00:00.000Z',
      properties: { source: 'direct' },
    }
    const payload = { events: [analyticsEvent] }
    const first = await app.inject({ method: 'POST', url: '/v1/events/batch', headers: { authorization }, payload })
    const repeated = await app.inject({ method: 'POST', url: '/v1/events/batch', headers: { authorization }, payload })
    expect(first.json().data.accepted).toBe(1)
    expect(repeated.json().data.accepted).toBe(0)
  })

  it('数据库不保存安装标识和 token 明文', async () => {
    const installationId = '11111111-1111-4111-8111-111111111111'
    const rows = await database.pool.query('SELECT installation_hash FROM guest_identities LIMIT 1')
    expect(rows.rows[0].installation_hash).toBe(
      createHash('sha256').update(installationId).digest('hex'),
    )
    const sessions = await database.pool.query('SELECT token_hash FROM auth_sessions LIMIT 1')
    expect(sessions.rows[0].token_hash).toBe(
      createHash('sha256').update(issuedToken).digest('hex'),
    )
    expect(sessions.rows[0].token_hash).not.toBe(issuedToken)
  })

  it('保护管理接口并支持草稿、发布、回滚和下架', async () => {
    const publicOnlyApp = createApp({ databaseUrl })
    await publicOnlyApp.ready()
    const unavailable = await publicOnlyApp.inject({ method: 'GET', url: '/v1/admin/session' })
    const publicContent = await publicOnlyApp.inject({ method: 'GET', url: '/v1/content/current' })
    expect(unavailable.statusCode).toBe(503)
    expect(publicContent.statusCode).toBe(200)
    await publicOnlyApp.close()

    const denied = await app.inject({ method: 'GET', url: '/v1/admin/session', headers: { authorization: 'Bearer invalid' } })
    expect(denied.statusCode).toBe(401)
    const session = await app.inject({ method: 'GET', url: '/v1/admin/session', headers: { authorization: adminAuthorization } })
    expect(session.statusCode).toBe(200)

    const created = await app.inject({ method: 'POST', url: '/v1/admin/content/drafts', headers: { authorization: adminAuthorization }, payload: {} })
    expect(created.statusCode).toBe(201)
    const draft = created.json().data
    draft.bundle.sessions['boundary-decline-001'].title = '说明边界并协商优先级'
    const saved = await app.inject({
      method: 'PUT', url: `/v1/admin/content/drafts/${draft.id}`, headers: { authorization: adminAuthorization },
      payload: { revision: draft.revision, bundle: draft.bundle },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json().data.revision).toBe(2)
    const stale = await app.inject({
      method: 'PUT', url: `/v1/admin/content/drafts/${draft.id}`, headers: { authorization: adminAuthorization },
      payload: { revision: 1, bundle: draft.bundle },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('draft_conflict')
    const validation = await app.inject({ method: 'POST', url: `/v1/admin/content/drafts/${draft.id}/validate`, headers: { authorization: adminAuthorization } })
    expect(validation.json().data.valid).toBe(true)
    expect(validation.json().data.normalizedBundle.releaseVersion).toBe(2)
    expect(validation.json().data.normalizedBundle.sessions['boundary-decline-001'].contentVersion).toBe(2)
    const published = await app.inject({
      method: 'POST', url: `/v1/admin/content/drafts/${draft.id}/publish`, headers: { authorization: adminAuthorization },
      payload: { revision: 2, reason: '验证内容发布闭环' },
    })
    expect(published.statusCode).toBe(201)
    expect(published.json().data.releaseVersion).toBe(2)
    const releases = await app.inject({ method: 'GET', url: '/v1/admin/content/releases', headers: { authorization: adminAuthorization } })
    expect(releases.statusCode).toBe(200)
    expect(releases.json().data.releases[0].sessionCount).toBe(10)

    const rollback = await app.inject({ method: 'POST', url: '/v1/admin/content/releases/1/rollback-draft', headers: { authorization: adminAuthorization } })
    expect(rollback.statusCode).toBe(201)
    expect(rollback.json().data.baseReleaseVersion).toBe(1)
    const withdrawn = await app.inject({
      method: 'POST', url: '/v1/admin/content/current/sessions/boundary-priority-002/withdraw',
      headers: { authorization: adminAuthorization }, payload: { confirmation: 'WITHDRAW', reason: '集成测试紧急下架' },
    })
    expect(withdrawn.statusCode).toBe(201)
    expect(withdrawn.json().data.releaseVersion).toBe(3)
    const current = await app.inject({ method: 'GET', url: '/v1/content/current' })
    expect(current.json().data.bundle.sessions['boundary-priority-002']).toBeUndefined()
    const historical = await database.pool.query(`SELECT count(*)::int count FROM content_releases
      WHERE bundle->'sessions' ? 'boundary-priority-002'`)
    expect(historical.rows[0].count).toBe(2)

    const invalidDraft = await app.inject({ method: 'POST', url: '/v1/admin/content/drafts', headers: { authorization: adminAuthorization }, payload: {} })
    const invalidSaved = await app.inject({
      method: 'PUT', url: `/v1/admin/content/drafts/${invalidDraft.json().data.id}`,
      headers: { authorization: adminAuthorization }, payload: { revision: 1, bundle: {} },
    })
    const invalidPublish = await app.inject({
      method: 'POST', url: `/v1/admin/content/drafts/${invalidDraft.json().data.id}/publish`,
      headers: { authorization: adminAuthorization }, payload: { revision: invalidSaved.json().data.revision, reason: '验证非法草稿拦截' },
    })
    expect(invalidPublish.statusCode).toBe(422)
    expect(invalidPublish.json().error.code).toBe('content_invalid')

    const [draftA, draftB] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/admin/content/drafts', headers: { authorization: adminAuthorization }, payload: {} }),
      app.inject({ method: 'POST', url: '/v1/admin/content/drafts', headers: { authorization: adminAuthorization }, payload: {} }),
    ])
    const concurrent = await Promise.all([draftA, draftB].map((item, index) => app.inject({
      method: 'POST', url: `/v1/admin/content/drafts/${item.json().data.id}/publish`, headers: { authorization: adminAuthorization },
      payload: { revision: 1, reason: `并发发布验证 ${index + 1}` },
    })))
    expect(concurrent.map((response) => response.statusCode)).toEqual([201, 201])
    expect(concurrent.map((response) => response.json().data.releaseVersion).sort()).toEqual([4, 5])
  })

  it('处理反馈并返回聚合漏斗，不暴露账号标识', async () => {
    const guest = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { installationId: '55555555-5555-4555-8555-555555555555' } })
    const userAuthorization = `Bearer ${guest.json().data.token}`
    const submitted = await app.inject({
      method: 'POST', url: '/v1/feedback', headers: { authorization: userAuthorization },
      payload: { category: 'product_suggestion', detail: '希望后台能够更清楚地展示学习漏斗。' },
    })
    expect(submitted.statusCode).toBe(201)
    const listed = await app.inject({ method: 'GET', url: '/v1/admin/feedback?status=new', headers: { authorization: adminAuthorization } })
    expect(listed.json().data.items[0].detail).toContain('学习漏斗')
    const updated = await app.inject({
      method: 'PATCH', url: `/v1/admin/feedback/${submitted.json().data.feedbackId}`,
      headers: { authorization: adminAuthorization }, payload: { status: 'resolved', internalNote: '已纳入本轮实现' },
    })
    expect(updated.statusCode, updated.body).toBe(200)
    expect(updated.json().data.status).toBe('resolved')
    expect(updated.json().data.resolvedAt).toBeTruthy()

    const now = Date.now() - 30_000
    const events = [
      { eventId: '60000000-0000-4000-8000-000000000001', name: 'app_open', occurredAt: new Date(now).toISOString(), properties: { source: 'direct' } },
      { eventId: '60000000-0000-4000-8000-000000000002', name: 'onboarding_view', occurredAt: new Date(now + 1_000).toISOString(), properties: { isFirstVisit: true } },
      { eventId: '60000000-0000-4000-8000-000000000003', name: 'training_start', occurredAt: new Date(now + 2_000).toISOString(), properties: { sessionId: 'boundary-decline-001', contentVersion: 2, entry: 'onboarding' } },
      { eventId: '60000000-0000-4000-8000-000000000004', name: 'option_select', occurredAt: new Date(now + 3_000).toISOString(), properties: { sessionId: 'boundary-decline-001', contentVersion: 2, optionId: 'constructive-boundary', displayPosition: 0, rating: 'recommended' } },
      { eventId: '60000000-0000-4000-8000-000000000005', name: 'training_complete', occurredAt: new Date(now + 4_000).toISOString(), properties: { sessionId: 'boundary-decline-001', contentVersion: 2, durationMs: 2_000, practiceUsed: false } },
      { eventId: '60000000-0000-4000-8000-000000000006', name: 'wechat_login_success', occurredAt: new Date(now + 5_000).toISOString(), properties: { merged: false } },
    ]
    const accepted = await app.inject({ method: 'POST', url: '/v1/events/batch', headers: { authorization: userAuthorization }, payload: { events } })
    expect(accepted.json().data.accepted).toBe(6)
    const metrics = await app.inject({ method: 'GET', url: '/v1/admin/metrics?window=7d', headers: { authorization: adminAuthorization } })
    expect(metrics.statusCode).toBe(200)
    const funnelCounts = metrics.json().data.funnel.map((stage: { accounts: number }) => stage.accounts)
    expect(funnelCounts[0]).toBeGreaterThanOrEqual(1)
    expect(funnelCounts.slice(1)).toEqual([1, 1, 1, 1, 1])
    expect(JSON.stringify(metrics.json())).not.toContain(guest.json().data.accountId)
  })

  it('幂等合并安全学习状态', async () => {
    const session = trainingContentBundle.sessions['boundary-decline-001']
    const choice = session?.cards.find((card) => card.type === 'choice')
    const option = choice?.options[0]
    const principle = session?.cards.find((card) => card.type === 'principle')
    if (!session || !choice || !option || !principle) throw new Error('缺少同步测试内容')
    const updatedAt = new Date(Date.now() - 60_000).toISOString()
    const payload = {
      requestId: '33333333-3333-4333-8333-333333333333',
      preference: {
        schemaVersion: 1, onboardingStatus: 'completed', selectedCatalogIds: ['boundary-communication'],
        completedAt: updatedAt, updatedAt,
      },
      favorites: [{
        favoriteId: `${session.sessionId}:${principle.id}`, sessionId: session.sessionId,
        contentVersion: session.contentVersion, cardId: principle.id, active: true,
        createdAt: updatedAt, updatedAt,
      }],
      reviews: [],
      progress: [{
        sessionId: session.sessionId, contentVersion: session.contentVersion,
        attemptId: 'integration-attempt', status: 'in_progress', currentCardIndex: 1,
        selectedOptionId: option.id, choiceConfirmed: false,
        startedAt: updatedAt, updatedAt, completedAt: null,
      }],
      activities: [],
    }
    const first = await app.inject({ method: 'POST', url: '/v1/sync', headers: { authorization }, payload })
    const repeated = await app.inject({ method: 'POST', url: '/v1/sync', headers: { authorization }, payload })
    expect(first.statusCode).toBe(200)
    expect(repeated.statusCode).toBe(200)
    expect(first.json().data.favorites).toHaveLength(1)
    expect(first.json().data.progress[0]).not.toHaveProperty('practiceText')
    const requests = await database.pool.query('SELECT count(*)::int AS count FROM sync_requests')
    expect(requests.rows[0].count).toBe(1)
  })

  it('微信登录升级游客并拒绝换绑其他微信身份', async () => {
    const upgraded = await app.inject({
      method: 'POST', url: '/v1/auth/wechat', headers: { authorization }, payload: { code: 'openid-a' },
    })
    expect(upgraded.statusCode).toBe(200)
    expect(upgraded.json().data.authType).toBe('wechat')
    const wechatAuthorization = `Bearer ${upgraded.json().data.token}`
    const conflict = await app.inject({
      method: 'POST', url: '/v1/auth/wechat', headers: { authorization: wechatAuthorization }, payload: { code: 'openid-b' },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json().error.code).toBe('ACCOUNT_CONFLICT')

    const secondGuest = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: { installationId: '44444444-4444-4444-8444-444444444444' } })
    const merged = await app.inject({
      method: 'POST', url: '/v1/auth/wechat',
      headers: { authorization: `Bearer ${secondGuest.json().data.token}` }, payload: { code: 'openid-a' },
    })
    expect(merged.statusCode).toBe(200)
    expect(merged.json().data.merged).toBe(true)
  })
})
