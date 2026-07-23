import type {
  ChoiceCard,
  ScenarioCard,
  TrainingOption,
  TrainingSession,
} from '@microly/content-schema'

import type { CourseOverview } from '../training/course-overview'

export interface ChallengeState {
  selectedOptionId: string | null
  answerConfirmed: boolean
}

export type ChallengeAction =
  | { type: 'SELECT'; optionId: string }
  | { type: 'CONFIRM' }

export interface ChallengeContent {
  scenarioCard: ScenarioCard
  choiceCard: ChoiceCard
  recommendedOption: TrainingOption
}

export type ChallengeContinuation =
  | {
      type: 'training'
      sessionId: string
      label: '从第一组开始' | '继续我的训练'
    }
  | { type: 'course'; label: '查看已完成课程' }

export function createChallengeState(): ChallengeState {
  return { selectedOptionId: null, answerConfirmed: false }
}

export function transitionChallenge(
  state: ChallengeState,
  action: ChallengeAction,
  choiceCard: ChoiceCard,
): ChallengeState {
  switch (action.type) {
    case 'SELECT':
      if (
        state.answerConfirmed
        || !choiceCard.options.some((option) => option.id === action.optionId)
      ) return state
      return { ...state, selectedOptionId: action.optionId }
    case 'CONFIRM':
      if (!state.selectedOptionId || state.answerConfirmed) return state
      return { ...state, answerConfirmed: true }
    default:
      return state
  }
}

export function resolveChallengeContent(
  session: TrainingSession,
): ChallengeContent | null {
  const scenarioCard = session.cards.find(
    (card): card is ScenarioCard => card.type === 'scenario',
  )
  const choiceCard = session.cards.find(
    (card): card is ChoiceCard => card.type === 'choice',
  )
  const recommendedOption = choiceCard?.options.find(
    (option) => option.rating === 'recommended',
  )
  return scenarioCard && choiceCard && recommendedOption
    ? { scenarioCard, choiceCard, recommendedOption }
    : null
}

export function selectChallengeContinuation(
  overview: CourseOverview,
  hasExistingLearningData: boolean,
): ChallengeContinuation {
  if (overview.allCompleted || !overview.activeItem?.session) {
    return { type: 'course', label: '查看已完成课程' }
  }
  return {
    type: 'training',
    sessionId: overview.activeItem.session.sessionId,
    label: hasExistingLearningData ? '继续我的训练' : '从第一组开始',
  }
}
