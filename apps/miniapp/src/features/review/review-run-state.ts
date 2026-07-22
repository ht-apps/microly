export interface ReviewRunState {
  itemCount: number
  currentIndex: number
  selectedOptionId: string | null
  answerConfirmed: boolean
  lastAnswerCorrect: boolean | null
  correctCount: number
  completed: boolean
}

export type ReviewRunAction =
  | { type: 'START'; itemCount: number }
  | { type: 'SELECT'; optionId: string }
  | { type: 'CONFIRM'; isCorrect: boolean }
  | { type: 'NEXT' }

export function createReviewRunState(): ReviewRunState {
  return {
    itemCount: 0,
    currentIndex: 0,
    selectedOptionId: null,
    answerConfirmed: false,
    lastAnswerCorrect: null,
    correctCount: 0,
    completed: false,
  }
}

export function transitionReviewRun(
  state: ReviewRunState,
  action: ReviewRunAction,
): ReviewRunState {
  switch (action.type) {
    case 'START':
      return {
        ...createReviewRunState(),
        itemCount: Math.max(0, action.itemCount),
      }
    case 'SELECT':
      if (state.answerConfirmed || state.completed || state.itemCount === 0) {
        return state
      }
      return { ...state, selectedOptionId: action.optionId }
    case 'CONFIRM':
      if (!state.selectedOptionId || state.answerConfirmed || state.completed) {
        return state
      }
      return {
        ...state,
        answerConfirmed: true,
        lastAnswerCorrect: action.isCorrect,
        correctCount: state.correctCount + (action.isCorrect ? 1 : 0),
      }
    case 'NEXT':
      if (!state.answerConfirmed || state.completed) return state
      if (state.currentIndex >= state.itemCount - 1) {
        return { ...state, completed: true }
      }
      return {
        ...state,
        currentIndex: state.currentIndex + 1,
        selectedOptionId: null,
        answerConfirmed: false,
        lastAnswerCorrect: null,
      }
    default:
      return state
  }
}
