import { createHash, randomBytes } from 'node:crypto'

import {
  AnalyticsBatchRequestSchema,
  GuestAuthRequestSchema,
  TrainingCompletionSchema,
  type TrainingCompletion,
} from '@microly/api-contract'
import { TrainingContentBundleSchema } from '@microly/content-schema'
import { and, desc, eq, gt } from 'drizzle-orm'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

import { createDatabase, type DatabaseContext } from './db/client.js'
import {
  analyticsEvents,
  authSessions,
  contentReleases,
  guestIdentities,
  trainingCompletions,
} from './db/schema.js'

const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000

function hashSecret(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function error(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } })
}

function serializeCompletion(row: typeof trainingCompletions.$inferSelect): TrainingCompletion {
  return {
    syncId: row.syncId,
    sessionId: row.sessionId,
    contentVersion: row.contentVersion,
    selectedOptionId: row.selectedOptionId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
  }
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  database: DatabaseContext,
) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    error(reply, 401, 'unauthorized', '需要游客身份。')
    return null
  }

  const token = authorization.slice('Bearer '.length).trim()
  if (!token) {
    error(reply, 401, 'unauthorized', '需要游客身份。')
    return null
  }

  const [session] = await database.db.select()
    .from(authSessions)
    .where(and(
      eq(authSessions.tokenHash, hashSecret(token)),
      gt(authSessions.expiresAt, new Date()),
    ))
    .limit(1)

  if (!session) {
    error(reply, 401, 'session_expired', '游客身份已过期。')
    return null
  }

  await database.db.update(authSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(authSessions.id, session.id))
  return session.guestId
}

export interface CreateAppOptions {
  databaseUrl: string
  logger?: boolean
}

export function createApp(options: CreateAppOptions) {
  const database = createDatabase(options.databaseUrl)
  const app = Fastify({ logger: options.logger ?? false })

  app.addHook('onClose', async () => {
    await database.pool.end()
  })

  app.setErrorHandler((cause, _request, reply) => {
    if (cause instanceof ZodError) {
      return error(reply, 400, 'invalid_request', '请求内容不符合接口约定。')
    }
    app.log.error(cause)
    return error(reply, 500, 'internal_error', '服务暂时不可用。')
  })

  app.get('/health', async (_request, reply) => {
    try {
      await database.pool.query('SELECT 1')
      return reply.send({ data: { process: 'ok', database: 'ok' } })
    } catch {
      return reply.status(503).send({ data: { process: 'ok', database: 'unavailable' } })
    }
  })

  app.get('/v1/content/current', async (request, reply) => {
    const [release] = await database.db.select()
      .from(contentReleases)
      .orderBy(desc(contentReleases.releaseVersion))
      .limit(1)
    if (!release) return error(reply, 404, 'content_unavailable', '暂无已发布课程。')

    const etag = `"${release.checksum}"`
    reply.header('ETag', etag)
    reply.header('Cache-Control', 'no-cache')
    if (request.headers['if-none-match'] === etag) return reply.status(304).send()

    const bundle = TrainingContentBundleSchema.parse(release.bundle)
    return reply.send({ data: { bundle, checksum: release.checksum } })
  })

  app.post('/v1/auth/guest', async (request, reply) => {
    const body = GuestAuthRequestSchema.parse(request.body)
    const installationHash = hashSecret(body.installationId)
    const inserted = await database.db.insert(guestIdentities)
      .values({ installationHash })
      .onConflictDoNothing({ target: guestIdentities.installationHash })
      .returning()
    const [guest] = inserted.length > 0
      ? inserted
      : await database.db.select()
        .from(guestIdentities)
        .where(eq(guestIdentities.installationHash, installationHash))
        .limit(1)
    if (!guest) throw new Error('Guest identity was not created')

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS)
    await database.db.insert(authSessions).values({
      guestId: guest.id,
      tokenHash: hashSecret(token),
      expiresAt,
    })
    return reply.send({
      data: { guestId: guest.id, token, expiresAt: expiresAt.toISOString() },
    })
  })

  app.get('/v1/training-completions', async (request, reply) => {
    const guestId = await authenticate(request, reply, database)
    if (!guestId) return
    const rows = await database.db.select()
      .from(trainingCompletions)
      .where(eq(trainingCompletions.guestId, guestId))
      .orderBy(trainingCompletions.completedAt)
    return reply.send({ data: rows.map(serializeCompletion) })
  })

  app.post('/v1/training-completions', async (request, reply) => {
    const guestId = await authenticate(request, reply, database)
    if (!guestId) return
    const completion = TrainingCompletionSchema.parse(request.body)

    const releases = await database.db.select({ bundle: contentReleases.bundle })
      .from(contentReleases)
      .orderBy(desc(contentReleases.releaseVersion))
    const matchingSession = releases.flatMap(({ bundle }) => {
      const parsed = TrainingContentBundleSchema.safeParse(bundle)
      if (!parsed.success) return []
      const session = parsed.data.sessions[completion.sessionId]
      return session?.contentVersion === completion.contentVersion ? [session] : []
    })[0]
    const choice = matchingSession?.cards.find((card) => card.type === 'choice')
    if (!choice?.options.some((option) => option.id === completion.selectedOptionId)) {
      return error(reply, 422, 'invalid_completion', '训练版本或选项不存在。')
    }

    const inserted = await database.db.insert(trainingCompletions).values({
      guestId,
      syncId: completion.syncId,
      sessionId: completion.sessionId,
      contentVersion: completion.contentVersion,
      selectedOptionId: completion.selectedOptionId,
      startedAt: new Date(completion.startedAt),
      completedAt: new Date(completion.completedAt),
    }).onConflictDoNothing({
      target: [trainingCompletions.guestId, trainingCompletions.syncId],
    }).returning()

    const [stored] = inserted.length > 0
      ? inserted
      : await database.db.select()
        .from(trainingCompletions)
        .where(and(
          eq(trainingCompletions.guestId, guestId),
          eq(trainingCompletions.syncId, completion.syncId),
        ))
        .limit(1)
    if (!stored) throw new Error('Training completion was not stored')
    return reply.status(inserted.length > 0 ? 201 : 200).send({ data: serializeCompletion(stored) })
  })

  app.post('/v1/events/batch', async (request, reply) => {
    const guestId = await authenticate(request, reply, database)
    if (!guestId) return
    const batch = AnalyticsBatchRequestSchema.parse(request.body)
    let accepted = 0
    for (const event of batch.events) {
      const inserted = await database.db.insert(analyticsEvents).values({
        eventId: event.eventId,
        guestId,
        name: event.name,
        occurredAt: new Date(event.occurredAt),
        properties: event.properties,
      }).onConflictDoNothing({ target: analyticsEvents.eventId }).returning({
        eventId: analyticsEvents.eventId,
      })
      accepted += inserted.length
    }
    return reply.send({ data: { accepted } })
  })

  return app
}
