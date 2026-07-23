import { readdir, readFile } from 'node:fs/promises'

import type { DatabaseContext } from './client.js'

export async function migrateDatabase(database: DatabaseContext) {
  const migrationsUrl = new URL('../../drizzle/', import.meta.url)
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()
  await database.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  for (const filename of files) {
    const applied = await database.pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename])
    if (applied.rowCount) continue
    const migration = await readFile(new URL(filename, migrationsUrl), 'utf8')
    const client = await database.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(migration)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
      await client.query('COMMIT')
    } catch (cause) {
      await client.query('ROLLBACK')
      throw cause
    } finally {
      client.release()
    }
  }
}
