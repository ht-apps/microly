import type { FastifyBaseLogger } from 'fastify'
import { TrainingContentBundleSchema } from '@microly/content-schema'

import type { DatabaseContext } from './db/client.js'
import type { RuntimeMetrics } from './runtime-metrics.js'

type Alert = { key: string; level: 'attention' | 'critical'; title: string; detail: Record<string, string | number | boolean | null> }

export class RuntimeAlertMonitor {
  private timer?: NodeJS.Timeout
  private readonly fallbackStates = new Map<string, { level: Alert['level']; lastSentAt: number }>()

  constructor(private readonly options: {
    database: DatabaseContext
    metrics: RuntimeMetrics
    webhookUrl: string
    cooldownMinutes: number
    environment: string
    appVersion: string
    logger: FastifyBaseLogger
    fetcher?: typeof fetch
  }) {}

  start() {
    void this.check().catch(() => undefined)
    this.timer = setInterval(() => void this.check().catch(() => undefined), 60_000)
    this.timer.unref()
  }

  stop() { if (this.timer) clearInterval(this.timer) }

  async check() {
    const alerts: Alert[] = []
    try { await this.options.database.pool.query('SELECT 1') } catch { alerts.push({ key: 'database_unavailable', level: 'critical', title: '数据库不可用', detail: {} }) }
    try {
      const content = await this.options.database.pool.query('SELECT release_version,bundle FROM content_releases ORDER BY release_version DESC LIMIT 1')
      if (!content.rows[0] || !TrainingContentBundleSchema.safeParse(content.rows[0].bundle).success) {
        alerts.push({ key: 'content_unavailable', level: 'critical', title: '没有可用内容版本', detail: {} })
      }
      const fatal = await this.options.database.pool.query(`SELECT count(*)::int count FROM client_error_reports
        WHERE severity='fatal' AND received_at >= now() - interval '10 minutes'`)
      const fatalCount = Number(fatal.rows[0]?.count ?? 0)
      if (fatalCount) alerts.push({ key: 'fatal_client_errors', level: 'critical', title: '发现严重客户端错误', detail: { count: fatalCount } })
    } catch { /* Database alert already covers query failures. */ }
    const snapshot = this.options.metrics.snapshot(10 * 60_000)
    if (snapshot.requests >= 20 && snapshot.errorRate >= 0.1) {
      alerts.push({ key: 'api_5xx_rate', level: 'critical', title: 'API 5xx 错误率过高', detail: { requests: snapshot.requests, errorRate: snapshot.errorRate } })
    }
    await this.sync(alerts)
  }

  private async sync(alerts: Alert[]) {
    const activeKeys = new Set(alerts.map((alert) => alert.key))
    try {
      for (const alert of alerts) await this.activate(alert)
      const active = await this.options.database.pool.query('SELECT alert_key, level FROM runtime_alert_states WHERE active=true')
      for (const row of active.rows) {
        if (activeKeys.has(row.alert_key)) continue
        await this.send({ type: 'recovered', key: row.alert_key, level: row.level, title: '运行状态已恢复', detail: {} })
        await this.options.database.pool.query(`UPDATE runtime_alert_states SET active=false, recovered_at=now(), updated_at=now()
          WHERE alert_key=$1`, [row.alert_key])
      }
      await this.recoverFallback(activeKeys)
    } catch {
      await this.syncFallback(alerts)
    }
  }

  private async syncFallback(alerts: Alert[]) {
    const activeKeys = new Set(alerts.map((alert) => alert.key))
    const cooldownMs = this.options.cooldownMinutes * 60_000
    for (const alert of alerts) {
      const existing = this.fallbackStates.get(alert.key)
      if (!existing || Date.now() - existing.lastSentAt >= cooldownMs) {
        await this.send({ type: 'alert', ...alert })
        this.fallbackStates.set(alert.key, { level: alert.level, lastSentAt: Date.now() })
      }
    }
    for (const [key, state] of this.fallbackStates) {
      if (activeKeys.has(key)) continue
      await this.send({ type: 'recovered', key, level: state.level, title: '运行状态已恢复', detail: {} })
      this.fallbackStates.delete(key)
    }
  }

  private async recoverFallback(activeKeys: Set<string>) {
    for (const [key, state] of this.fallbackStates) {
      if (activeKeys.has(key)) { this.fallbackStates.delete(key); continue }
      await this.send({ type: 'recovered', key, level: state.level, title: '运行状态已恢复', detail: {} })
      this.fallbackStates.delete(key)
    }
  }

  private async activate(alert: Alert) {
    const existing = await this.options.database.pool.query('SELECT active, last_sent_at FROM runtime_alert_states WHERE alert_key=$1', [alert.key])
    const row = existing.rows[0]
    const cooldownMs = this.options.cooldownMinutes * 60_000
    const shouldSend = !row?.active || !row?.last_sent_at || Date.now() - new Date(row.last_sent_at).getTime() >= cooldownMs
    if (shouldSend) await this.send({ type: 'alert', ...alert })
    await this.options.database.pool.query(`INSERT INTO runtime_alert_states (alert_key,level,active,last_sent_at,recovered_at,updated_at)
      VALUES ($1,$2,true,CASE WHEN $3 THEN now() ELSE NULL END,NULL,now())
      ON CONFLICT (alert_key) DO UPDATE SET level=excluded.level, active=true,
      last_sent_at=CASE WHEN $3 THEN now() ELSE runtime_alert_states.last_sent_at END, recovered_at=NULL, updated_at=now()`,
    [alert.key, alert.level, shouldSend])
  }

  private async send(message: { type: 'alert' | 'recovered'; key: string; level: string; title: string; detail: Record<string, unknown> }) {
    try {
      const response = await (this.options.fetcher ?? fetch)(this.options.webhookUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({ ...message, environment: this.options.environment, appVersion: this.options.appVersion, occurredAt: new Date().toISOString() }),
      })
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`)
    } catch (cause) {
      this.options.logger.warn({ errorCode: 'alert_webhook_failed' }, cause instanceof Error ? cause.message : 'Alert webhook failed')
    }
  }
}
