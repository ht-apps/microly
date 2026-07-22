import { TrainingSessionSchema } from '@microly/content-schema'

import boundaryDeclineSession from './boundary-decline-001.json'

export const firstTrainingResult = TrainingSessionSchema.safeParse(
  boundaryDeclineSession,
)

export const firstTrainingSession = firstTrainingResult.success
  ? firstTrainingResult.data
  : null
