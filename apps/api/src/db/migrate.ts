import { readFile } from 'node:fs/promises'

import type { DatabaseContext } from './client.js'

export async function migrateDatabase(database: DatabaseContext) {
  const migrationUrl = new URL('../../drizzle/0000_initial.sql', import.meta.url)
  const migration = await readFile(migrationUrl, 'utf8')
  await database.pool.query(migration)
}
