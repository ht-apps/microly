import { readdir } from 'node:fs/promises'

import { readConfig } from '../config.js'
import { createDatabase } from '../db/client.js'

const database = createDatabase(readConfig().databaseUrl)
try {
  const migrationsUrl = new URL('../../drizzle/', import.meta.url)
  const expected = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()
  const exists = await database.pool.query(`SELECT to_regclass('public.schema_migrations') name`)
  const applied = exists.rows[0]?.name
    ? (await database.pool.query('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map((row) => row.filename as string)
    : []
  const pending = expected.filter((filename) => !applied.includes(filename))
  if (pending.length) {
    process.stderr.write(`存在 ${pending.length} 个未执行迁移：${pending.join('、')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(`数据库迁移已就绪（${applied.length}/${expected.length}）。\n`)
  }
} finally {
  await database.pool.end()
}
