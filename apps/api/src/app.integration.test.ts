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
const app = createApp({ databaseUrl })
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
    const completion = {
      syncId: 'completion:boundary-decline-001:v1:2026-07-23T10:03:00.000Z',
      sessionId: session.sessionId,
      contentVersion: session.contentVersion,
      selectedOptionId: option?.id,
      startedAt: '2026-07-23T10:00:00.000Z',
      completedAt: '2026-07-23T10:03:00.000Z',
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
    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/training-completions',
      headers: { authorization },
      payload: {
        syncId: 'invalid-option',
        sessionId: 'boundary-decline-001',
        contentVersion: 1,
        selectedOptionId: 'missing-option',
        startedAt: '2026-07-23T10:00:00.000Z',
        completedAt: '2026-07-23T10:03:00.000Z',
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
})
