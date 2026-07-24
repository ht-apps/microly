import { createHash } from 'node:crypto'

import { TrainingContentBundleSchema } from '@microly/content-schema'
import { remoteTrainingContentBundle } from '@microly/training-content'
import { sql } from 'drizzle-orm'

import type { DatabaseContext } from './client.js'

export function checksumBundle(bundle: unknown) {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex')
}

export async function seedContent(database: DatabaseContext) {
  const bundle = TrainingContentBundleSchema.parse(remoteTrainingContentBundle)
  const checksum = checksumBundle(bundle)
  await database.db.execute(sql`
    INSERT INTO content_releases (release_version, bundle, checksum)
    VALUES (${bundle.releaseVersion}, ${JSON.stringify(bundle)}::jsonb, ${checksum})
    ON CONFLICT (release_version) DO NOTHING
  `)
  return { bundle, checksum }
}
