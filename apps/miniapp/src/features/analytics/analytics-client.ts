import { AnalyticsEventSchema, type AnalyticsEvent } from '@microly/api-contract'
import Taro from '@tarojs/taro'

import { authorizedRequest } from '../network/guest-auth'
import { createUuid } from '../network/identifier'

export const ANALYTICS_OUTBOX_STORAGE_KEY = 'microly:analytics:outbox:v1'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const visitId = createUuid()

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface AnalyticsEnvelope {
  event: AnalyticsEvent
  attempts: number
  nextAttemptAt: string
}

type AnalyticsName = AnalyticsEvent['name']
type AnalyticsProperties<Name extends AnalyticsName> = Extract<
  AnalyticsEvent,
  { name: Name }
>['properties']

function readOutbox() {
  try {
    const value = Taro.getStorageSync<unknown>(ANALYTICS_OUTBOX_STORAGE_KEY)
    if (!Array.isArray(value)) return [] as AnalyticsEnvelope[]
    const cutoff = Date.now() - RETENTION_MS
    return value.flatMap((candidate): AnalyticsEnvelope[] => {
      if (!candidate || typeof candidate !== 'object') return []
      const envelope = candidate as AnalyticsEnvelope
      const parsed = AnalyticsEventSchema.safeParse(envelope.event)
      if (!parsed.success || Date.parse(parsed.data.occurredAt) < cutoff) return []
      return [{
        event: parsed.data,
        attempts: Number.isInteger(envelope.attempts) && envelope.attempts >= 0
          ? envelope.attempts
          : 0,
        nextAttemptAt: Number.isFinite(Date.parse(envelope.nextAttemptAt))
          ? envelope.nextAttemptAt
          : parsed.data.occurredAt,
      }]
    })
  } catch {
    return [] as AnalyticsEnvelope[]
  }
}

function writeOutbox(items: AnalyticsEnvelope[]) {
  try {
    Taro.setStorageSync(ANALYTICS_OUTBOX_STORAGE_KEY, items)
  } catch {
    // Analytics never blocks the learning flow.
  }
}

export function trackEvent<Name extends AnalyticsName>(
  name: Name,
  properties: AnalyticsProperties<Name>,
) {
  const occurred = new Date()
  const event = {
    eventId: createUuid(),
    visitId,
    name,
    occurredAt: occurred.toISOString(),
    localDateKey: localDateKey(occurred),
    timezoneOffsetMinutes: occurred.getTimezoneOffset(),
    properties,
  } as AnalyticsEvent
  writeOutbox([...readOutbox(), {
    event,
    attempts: 0,
    nextAttemptAt: event.occurredAt,
  }])
}

export async function flushAnalyticsOutbox() {
  const now = Date.now()
  const outbox = readOutbox()
  const due = outbox.filter((item) => Date.parse(item.nextAttemptAt) <= now).slice(0, 50)
  if (due.length === 0) return 0
  try {
    const response = await authorizedRequest<unknown>({
      path: '/v1/events/batch',
      method: 'POST',
      data: { events: due.map((item) => item.event) },
    })
    if (response && response.statusCode >= 200 && response.statusCode < 300) {
      const sentIds = new Set(due.map((item) => item.event.eventId))
      writeOutbox(outbox.filter((item) => !sentIds.has(item.event.eventId)))
      return due.length
    }
  } catch {
    // Keep events for the next foreground session.
  }

  const attemptedIds = new Set(due.map((item) => item.event.eventId))
  writeOutbox(outbox.map((item) => {
    if (!attemptedIds.has(item.event.eventId)) return item
    const attempts = item.attempts + 1
    const delay = Math.min(60 * 60 * 1000, 2 ** attempts * 1000)
    return { ...item, attempts, nextAttemptAt: new Date(now + delay).toISOString() }
  }))
  return 0
}
