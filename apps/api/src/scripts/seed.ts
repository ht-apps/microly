import { readConfig } from '../config.js'
import { createDatabase } from '../db/client.js'
import { seedContent } from '../db/seed.js'

const database = createDatabase(readConfig().databaseUrl)
try {
  const seeded = await seedContent(database)
  process.stdout.write(`内容版本 ${seeded.bundle.releaseVersion} 已就绪。\n`)
} finally {
  await database.pool.end()
}
