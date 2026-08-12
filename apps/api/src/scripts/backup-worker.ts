import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { readConfig } from '../config.js'
import { createDatabase } from '../db/client.js'

const execute = promisify(execFile)
const config = readConfig()
const database = createDatabase(config.databaseUrl)
const backupDir = process.env.BACKUP_DIR || '/backups'

async function record(query: string, parameters: unknown[]) {
  try { await database.pool.query(query, parameters) } catch { /* The first pre-migration backup has no ledger yet. */ }
}

function databaseEnvironment(url: string) {
  const parsed = new URL(url)
  return { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: parsed.pathname.replace(/^\//u, '') }
}

function backupDay(value: string) {
  return /^microly-(\d{8})T\d{6}Z\.dump$/u.exec(value)?.[1] ?? ''
}

function isoWeek(day: string) {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))))
  const target = new Date(date)
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return `${target.getUTCFullYear()}-${Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)}`
}

async function prune() {
  const files = (await readdir(backupDir)).filter((name) => /^microly-\d{8}T\d{6}Z\.dump$/u.test(name)).sort().reverse()
  const dailyDays = new Set<string>()
  for (const name of files) {
    if (dailyDays.size >= 14 && !dailyDays.has(backupDay(name))) continue
    dailyDays.add(backupDay(name))
  }
  const keep = new Set(files.filter((name) => dailyDays.has(backupDay(name))))
  const weekly = new Set<string>()
  for (const name of files.filter((file) => !keep.has(file))) {
    const week = isoWeek(backupDay(name))
    if (weekly.size < 8 && !weekly.has(week)) { weekly.add(week); keep.add(name) }
  }
  await Promise.all(files.filter((name) => !keep.has(name)).map((name) => unlink(join(backupDir, name))))
}

async function checksumFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function createBackup(kind: 'scheduled' | 'pre_release' | 'manual' = 'scheduled') {
  await mkdir(backupDir, { recursive: true })
  const filename = `microly-${new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '')}.dump`
  const path = join(backupDir, filename)
  await record(`INSERT INTO database_backups (filename,kind,status) VALUES ($1,$2,'running') ON CONFLICT (filename) DO NOTHING`, [filename, kind])
  try {
    const parsed = new URL(config.databaseUrl)
    await execute('pg_dump', ['-Fc', '-f', path, parsed.pathname.replace(/^\//u, '')], { env: databaseEnvironment(config.databaseUrl) })
    const info = await stat(path)
    if (!info.size) throw new Error('Backup file is empty')
    const checksum = await checksumFile(path)
    await record(`UPDATE database_backups SET status='succeeded',size_bytes=$2,checksum=$3,completed_at=now() WHERE filename=$1`, [filename, info.size, checksum])
    await prune()
    process.stdout.write(`${filename}\t${info.size}\t${checksum}\n`)
  } catch (cause) {
    await record(`UPDATE database_backups SET status='failed',completed_at=now() WHERE filename=$1`, [filename])
    throw cause
  }
}

try {
  if (process.env.BACKUP_ONCE === 'true') await createBackup((process.env.BACKUP_KIND as 'scheduled' | 'pre_release' | 'manual') || 'manual')
  else {
    const interval = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24)) * 3_600_000
    for (;;) {
      await createBackup('scheduled').catch((cause) => process.stderr.write(`backup_failed: ${cause instanceof Error ? cause.message : 'unknown'}\n`))
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }
} finally { await database.pool.end() }
