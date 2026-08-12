import { basename } from 'node:path'

import { readConfig } from '../config.js'
import { createDatabase } from '../db/client.js'

const filename = basename(process.argv[2] || '')
if (!/^microly-\d{8}T\d{6}Z\.dump$/u.test(filename)) throw new Error('Backup filename is invalid')
const database = createDatabase(readConfig().databaseUrl)
try {
  const result = await database.pool.query('UPDATE database_backups SET restore_verified_at=now() WHERE filename=$1', [filename])
  if (!result.rowCount) throw new Error('Backup record was not found')
} finally { await database.pool.end() }
