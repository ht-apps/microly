import { readConfig } from '../config.js'
import { createDatabase } from '../db/client.js'

const status = process.argv[2]
if (!['deploying', 'healthy', 'failed', 'rolled_back'].includes(status ?? '')) throw new Error('Deployment status is invalid')
const config = readConfig()
const database = createDatabase(config.databaseUrl)
try {
  const imageTag = process.env.MICROLY_IMAGE_TAG || config.runtime.appVersion
  const [content, migration, prior] = await Promise.all([
    database.pool.query('SELECT release_version FROM content_releases ORDER BY release_version DESC LIMIT 1'),
    database.pool.query('SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1'),
    database.pool.query('SELECT app_version,git_commit FROM deployment_releases WHERE image_tag=$1 ORDER BY created_at DESC LIMIT 1', [imageTag]),
  ])
  const values = [prior.rows[0]?.app_version || process.env.DEPLOY_APP_VERSION || config.runtime.appVersion, process.env.DEPLOY_GIT_COMMIT || prior.rows[0]?.git_commit || '0000000', imageTag, migration.rows[0]?.filename ?? null, content.rows[0]?.release_version ?? null, status, process.env.DEPLOY_REASON || null]
  if (status === 'deploying') {
    await database.pool.query(`INSERT INTO deployment_releases (app_version,git_commit,image_tag,migration_version,content_version,status,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)`, values)
  } else {
    const result = await database.pool.query(`UPDATE deployment_releases SET status=$6,reason=COALESCE($7,reason),completed_at=now() WHERE id=(SELECT id FROM deployment_releases WHERE image_tag=$3 ORDER BY created_at DESC LIMIT 1)`, values)
    if (!result.rowCount) await database.pool.query(`INSERT INTO deployment_releases (app_version,git_commit,image_tag,migration_version,content_version,status,reason,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`, values)
  }
} finally { await database.pool.end() }
