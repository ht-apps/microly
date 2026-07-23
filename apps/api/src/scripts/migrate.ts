import { readConfig } from '../config.js'
import { createDatabase } from '../db/client.js'
import { migrateDatabase } from '../db/migrate.js'

const database = createDatabase(readConfig().databaseUrl)
try {
  await migrateDatabase(database)
  process.stdout.write('数据库迁移完成。\n')
} finally {
  await database.pool.end()
}
