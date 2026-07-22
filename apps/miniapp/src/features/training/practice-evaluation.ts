import type { PracticeCard } from '@microly/content-schema'

export type PracticeDimensionStatus = 'detected' | 'missing'

export interface PracticeEvaluationItem {
  dimensionId: string
  status: PracticeDimensionStatus
  matchedKeywords: string[]
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

export function evaluatePractice(
  text: string,
  card: PracticeCard,
): PracticeEvaluationItem[] {
  const normalizedText = normalize(text)

  return card.dimensions.map((dimension) => {
    const matchedKeywords = dimension.keywords.filter((keyword) =>
      normalizedText.includes(normalize(keyword)),
    )

    return {
      dimensionId: dimension.id,
      status: matchedKeywords.length > 0 ? 'detected' : 'missing',
      matchedKeywords,
    }
  })
}
