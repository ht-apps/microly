import type { TrainingSession } from '@microly/content-schema'

export interface ChallengeSharePayload {
  title: string
  path: string
  imageUrl: string
}

export const CHALLENGE_SHARE_IMAGE_URL = '/assets/share/challenge-cover.png'

export function createChallengeSharePayload(
  session: Pick<TrainingSession, 'sessionId' | 'title'>,
): ChallengeSharePayload {
  return {
    title: `如果是你，会怎么回应？｜${session.title}`,
    path: `/pages/challenge/index?sessionId=${encodeURIComponent(session.sessionId)}&source=challenge`,
    imageUrl: CHALLENGE_SHARE_IMAGE_URL,
  }
}
