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
  wechat: { appId: 'wx-test', appSecret: 'test-secret', identityHashSecret: 'identity-secret-with-at-least-32-characters' },
  exchangeWechatCode: async (code) => ({ openid: code }),
})
let authorization = ''
let issuedToken = ''

beforeAll(async () => {
  await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
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
