import {
  ClientErrorBatchResponseSchema,
  ClientErrorReportSchema,
  type ClientErrorReport,
} from '@microly/api-contract'
import Taro from '@tarojs/taro'

import { authorizedRequest } from '../network/guest-auth'
import { createUuid } from '../network/identifier'
import { isNetworkEnabled } from '../network/network-config'

export const CLIENT_ERROR_OUTBOX_KEY = 'microly:client-errors:outbox:v1'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_REPORTS = 100
const APP_VERSION = process.env.TARO_APP_VERSION || '1.0.0'
const knownErrorNames = new Set(['error', 'typeerror', 'referenceerror', 'rangeerror', 'syntaxerror', 'aborterror', 'timeouterror'])

type ErrorEnvelope = { report: ClientErrorReport; attempts: number; nextAttemptAt: string }
let networkType: ClientErrorReport['networkType'] = 'unknown'
let installed = false

function safePage() {
  try {
    const pages = Taro.getCurrentPages() as Array<{ route?: string }>
    const route = pages[pages.length - 1]?.route ?? ''
    return `/${route.replace(/[^a-z0-9/_-]/gi, '').toLowerCase()}`.slice(0, 120) || '/'
  } catch { return '/' }
}

function safeErrorCode(cause: unknown, fallback = 'unknown_error') {
  const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name).toLowerCase() : ''
  return knownErrorNames.has(name) ? name : fallback
}

// Fingerprints are derived only from already-safe dimensions. Raw messages and stacks never enter storage.
export function stableErrorFingerprint(value: string) {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5]
  return seeds.map((seed) => {
    let hash = seed >>> 0
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

function readOutbox() {
  try {
    const value = Taro.getStorageSync<unknown>(CLIENT_ERROR_OUTBOX_KEY)
    if (!Array.isArray(value)) return [] as ErrorEnvelope[]
    const cutoff = Date.now() - RETENTION_MS
    return value.flatMap((candidate): ErrorEnvelope[] => {
      if (!candidate || typeof candidate !== 'object') return []
      const envelope = candidate as ErrorEnvelope
      const parsed = ClientErrorReportSchema.safeParse(envelope.report)
      if (!parsed.success || Date.parse(parsed.data.occurredAt) < cutoff) return []
      return [{ report: parsed.data, attempts: Number.isInteger(envelope.attempts) ? envelope.attempts : 0, nextAttemptAt: envelope.nextAttemptAt || parsed.data.occurredAt }]
    }).slice(-MAX_REPORTS)
  } catch { return [] as ErrorEnvelope[] }
}

function writeOutbox(items: ErrorEnvelope[]) {
  try { Taro.setStorageSync(CLIENT_ERROR_OUTBOX_KEY, items.slice(-MAX_REPORTS)) } catch { /* diagnostics never block learning */ }
}

export function captureClientError(
  category: ClientErrorReport['category'],
  cause: unknown,
  options: { severity?: ClientErrorReport['severity']; errorCode?: string; contentVersion?: number | null } = {},
) {
  const page = safePage()
  const errorCode = (options.errorCode ?? safeErrorCode(cause)).toLowerCase().replace(/[^a-z0-9_.:-]/g, '_').slice(0, 80) || 'unknown_error'
  const report: ClientErrorReport = {
    reportId: createUuid(),
    fingerprint: stableErrorFingerprint([category, options.severity ?? 'error', page, APP_VERSION, errorCode].join('|')),
    category,
    severity: options.severity ?? 'error',
    page,
    appVersion: APP_VERSION,
    contentVersion: options.contentVersion ?? null,
    networkType,
    errorCode,
    stackDigest: null,
    occurredAt: new Date().toISOString(),
  }
  writeOutbox([...readOutbox(), { report, attempts: 0, nextAttemptAt: report.occurredAt }])
  return report.reportId
}

export async function flushClientErrors() {
  if (!isNetworkEnabled()) return 0
  const now = Date.now()
  const outbox = readOutbox()
  const due = outbox.filter((item) => Date.parse(item.nextAttemptAt) <= now).slice(0, 20)
  if (!due.length) return 0
  try {
    const response = await authorizedRequest<unknown>({ path: '/v1/client-errors/batch', method: 'POST', data: { reports: due.map((item) => item.report) } })
    const parsed = ClientErrorBatchResponseSchema.safeParse(response?.data)
    if (response?.statusCode === 200 && parsed.success) {
      const sent = new Set(due.map((item) => item.report.reportId))
      writeOutbox(outbox.filter((item) => !sent.has(item.report.reportId)))
      return due.length
    }
  } catch { /* retry after next foreground session */ }
  const attempted = new Set(due.map((item) => item.report.reportId))
  writeOutbox(outbox.map((item) => attempted.has(item.report.reportId)
    ? { ...item, attempts: item.attempts + 1, nextAttemptAt: new Date(now + Math.min(60 * 60 * 1000, 2 ** (item.attempts + 1) * 1000)).toISOString() }
    : item))
  return 0
}

export function installClientErrorCapture() {
  if (installed) return
  installed = true
  if (typeof Taro.getNetworkType === 'function') void Taro.getNetworkType().then((result) => { networkType = normalizeNetworkType(result.networkType) }).catch(() => undefined)
  if (typeof Taro.onNetworkStatusChange === 'function') Taro.onNetworkStatusChange((result) => { networkType = result.isConnected ? normalizeNetworkType(result.networkType) : 'none' })
  if (typeof Taro.onError === 'function') Taro.onError((cause) => { captureClientError('runtime', cause, { severity: 'fatal' }) })
  if (typeof Taro.onUnhandledRejection === 'function') Taro.onUnhandledRejection((event) => { captureClientError('unhandled_rejection', event.reason, { severity: 'error' }) })
}

function normalizeNetworkType(value: string): ClientErrorReport['networkType'] {
  return ['wifi', '2g', '3g', '4g', '5g', 'none'].includes(value) ? value as ClientErrorReport['networkType'] : 'unknown'
}

export function readClientDiagnostics() {
  const outbox = readOutbox()
  return {
    appVersion: APP_VERSION,
    networkType,
    pendingReports: outbox.length,
    latestReportId: outbox[outbox.length - 1]?.report.reportId ?? null,
  }
}
