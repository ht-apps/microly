import type { RuntimeConfig, RuntimeFeatureFlags } from '@microly/api-contract'

import type { DatabaseContext } from './db/client.js'

export const DEFAULT_RUNTIME_FEATURES: RuntimeFeatureFlags = {
  wechatLogin: true,
  accountSync: true,
  aiEvaluation: true,
  feedback: true,
}

type RuntimeEnvironment = 'development' | 'test' | 'production'

export class RuntimeConfigStore {
  private cached?: { expiresAt: number; value: RuntimeConfig }

  constructor(
    private readonly database: DatabaseContext,
    private readonly environment: RuntimeEnvironment,
    private readonly apiVersion: string,
  ) {}

  async read(force = false): Promise<RuntimeConfig> {
    if (!force && this.cached && this.cached.expiresAt > Date.now()) return this.cached.value
    const result = await this.database.pool.query(`SELECT revision, minimum_supported_version,
      maintenance_active, maintenance_message, features FROM runtime_settings WHERE singleton=true`)
    const row = result.rows[0]
    const value: RuntimeConfig = {
      revision: Number(row?.revision ?? 1),
      environment: this.environment,
      apiVersion: this.apiVersion,
      minimumSupportedVersion: row?.minimum_supported_version ?? '1.0.0',
      maintenance: { active: Boolean(row?.maintenance_active), message: row?.maintenance_message ?? null },
      features: { ...DEFAULT_RUNTIME_FEATURES, ...(row?.features ?? {}) },
      serverTime: new Date().toISOString(),
    }
    this.cached = { value, expiresAt: Date.now() + 5_000 }
    return value
  }

  invalidate() { this.cached = undefined }
}

export function compareVersions(left: string, right: string) {
  const parts = (value: string) => value.split(/[+-]/u, 1)[0]!.split('.').map(Number)
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta) return delta
  }
  return 0
}
