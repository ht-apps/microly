import { describe, expect, it, vi } from 'vitest'

import { RuntimeAlertMonitor } from './runtime-alerts.js'
import { RuntimeMetrics } from './runtime-metrics.js'

describe('runtime alert monitor', () => {
  it('deduplicates active alerts and sends a recovery without sensitive details', async () => {
    let fatalCount = 1
    const states = new Map<string, { active: boolean; level: string; lastSentAt: Date | null }>()
    const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
      if (sql === 'SELECT 1') return { rowCount: 1, rows: [] }
      if (sql.includes('FROM content_releases')) return { rowCount: 1, rows: [{ release_version: 1, bundle: (await import('@microly/training-content')).remoteTrainingContentBundle }] }
      if (sql.includes("severity='fatal'")) return { rowCount: 1, rows: [{ count: fatalCount }] }
      if (sql.includes('SELECT alert_key, level')) return { rows: [...states].filter(([, value]) => value.active).map(([alert_key, value]) => ({ alert_key, level: value.level })) }
      if (sql.includes('SELECT active, last_sent_at')) {
        const value = states.get(String(parameters[0]))
        return { rows: value ? [{ active: value.active, last_sent_at: value.lastSentAt }] : [] }
      }
      if (sql.includes('INSERT INTO runtime_alert_states')) {
        states.set(String(parameters[0]), { active: true, level: String(parameters[1]), lastSentAt: parameters[2] ? new Date() : states.get(String(parameters[0]))?.lastSentAt ?? null })
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('active=false')) { const value = states.get(String(parameters[0])); if (value) value.active = false; return { rowCount: 1, rows: [] } }
      return { rowCount: 0, rows: [] }
    })
    const bodies: string[] = []
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response('{}', { status: 200 })
    })
    const monitor = new RuntimeAlertMonitor({
      database: { pool: { query } } as never, metrics: new RuntimeMetrics(), webhookUrl: 'https://alerts.example.com',
      cooldownMinutes: 30, environment: 'production', appVersion: '1.0.0', logger: { warn: vi.fn() } as never, fetcher: fetcher as typeof fetch,
    })
    await monitor.check()
    await monitor.check()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodies[0]).not.toContain('token')
    fatalCount = 0
    await monitor.check()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(bodies[1]).toContain('recovered')
  })

  it('still deduplicates database alerts while the alert ledger is unavailable', async () => {
    let available = false
    const query = vi.fn(async (sql: string) => {
      if (!available) throw new Error('database unavailable')
      if (sql === 'SELECT 1') return { rowCount: 1, rows: [] }
      if (sql.includes('FROM content_releases')) return { rowCount: 1, rows: [{ release_version: 1, bundle: (await import('@microly/training-content')).remoteTrainingContentBundle }] }
      if (sql.includes("severity='fatal'")) return { rowCount: 1, rows: [{ count: 0 }] }
      if (sql.includes('SELECT alert_key, level')) return { rows: [] }
      return { rowCount: 0, rows: [] }
    })
    const bodies: string[] = []
    const monitor = new RuntimeAlertMonitor({
      database: { pool: { query } } as never, metrics: new RuntimeMetrics(), webhookUrl: 'https://alerts.example.com',
      cooldownMinutes: 30, environment: 'production', appVersion: '1.0.0', logger: { warn: vi.fn() } as never,
      fetcher: (async (_input, init) => { bodies.push(String(init?.body)); return new Response('{}') }) as typeof fetch,
    })
    await monitor.check()
    await monitor.check()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('database_unavailable')
    available = true
    await monitor.check()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toContain('recovered')
  })
})
