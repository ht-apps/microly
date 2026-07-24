import { describe, expect, it } from 'vitest'

import { trainingContent } from '../../data/training-content'
import {
  createInitialProgress,
  type TrainingProgress,
} from '../training/training-state'
import {
  createReviewOverview,
  findChoiceCard,
  scheduleReviewAnswer,
  resolveReviewQuestion,
  upsertReviewFromTraining,
  type ReviewItem,
} from './review-state'

const now = '2026-07-23T08:00:00.000Z'
const firstSession = trainingContent.sessions[0]

if (!firstSession) throw new Error('缺少测试训练')

const choiceCard = findChoiceCard(firstSession)
if (!choiceCard) throw new Error('缺少选择卡')

const wrongOption = choiceCard.options.find(
  (option) => option.rating === 'not_recommended',
)
const riskyOption = choiceCard.options.find((option) => option.rating === 'risky')
const correctOption = choiceCard.options.find(
  (option) => option.rating === 'recommended',
)

if (!wrongOption || !riskyOption || !correctOption) {
  throw new Error('测试训练选项评级不完整')
}

function completedProgress(
  sessionId: string,
  contentVersion: number,
  selectedOptionId: string,
): TrainingProgress {
  return {
    ...createInitialProgress({
      ...firstSession,
      sessionId,
      contentVersion,
    }, now),
    status: 'completed',
    currentCardIndex: 5,
    selectedOptionId,
    choiceConfirmed: true,
    practiceEvaluation: [],
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  }
}

describe('review state', () => {
  it('仅为不建议选项创建复习项', () => {
    const wrong = upsertReviewFromTraining(
      [],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        wrongOption.id,
      ),
    )
    const risky = upsertReviewFromTraining(
      [],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        riskyOption.id,
      ),
    )
    const correct = upsertReviewFromTraining(
      [],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        correctOption.id,
      ),
    )

    expect(wrong.changed).toBe(true)
    expect(wrong.item?.intervalDays).toBe(1)
    expect(wrong.item?.dueAt).toBe('2026-07-24T08:00:00.000Z')
    expect(risky.changed).toBe(false)
    expect(correct.changed).toBe(false)
  })

  it('再次训练答错不重复建项并重置间隔', () => {
    const first = upsertReviewFromTraining(
      [],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        wrongOption.id,
      ),
    )
    const reviewed = scheduleReviewAnswer(
      first.item as ReviewItem,
      firstSession,
      correctOption.id,
      '2026-07-24T08:00:00.000Z',
    )
    const reset = upsertReviewFromTraining(
      [reviewed?.item as ReviewItem],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        wrongOption.id,
      ),
      '2026-07-25T08:00:00.000Z',
    )

    expect(reset.items).toHaveLength(1)
    expect(reset.item?.intervalDays).toBe(1)
    expect(reset.item?.consecutiveCorrect).toBe(0)
    expect(reset.item?.dueAt).toBe('2026-07-26T08:00:00.000Z')
  })

  it('正确复习按 3、7、14 天推进，错误回到 1 天', () => {
    const created = upsertReviewFromTraining(
      [],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        wrongOption.id,
      ),
    ).item as ReviewItem
    const first = scheduleReviewAnswer(created, firstSession, correctOption.id, now)
    const second = scheduleReviewAnswer(first?.item as ReviewItem, firstSession, correctOption.id, now)
    const third = scheduleReviewAnswer(second?.item as ReviewItem, firstSession, correctOption.id, now)
    const fourth = scheduleReviewAnswer(third?.item as ReviewItem, firstSession, correctOption.id, now)
    const wrong = scheduleReviewAnswer(fourth?.item as ReviewItem, firstSession, wrongOption.id, now)

    expect([first?.item.intervalDays, second?.item.intervalDays, third?.item.intervalDays, fourth?.item.intervalDays]).toEqual([3, 7, 14, 14])
    expect(wrong?.item.intervalDays).toBe(1)
    expect(wrong?.item.consecutiveCorrect).toBe(0)
  })

  it('到期项排序并限制每批最多五题，未来题允许单独访问', () => {
    const base = upsertReviewFromTraining(
      [],
      firstSession,
      completedProgress(
        firstSession.sessionId,
        firstSession.contentVersion,
        wrongOption.id,
      ),
    ).item as ReviewItem
    const dueItems = Array.from({ length: 6 }, (_, index) => ({
      ...base,
      reviewId: `review-${index}`,
      dueAt: `2026-07-2${index + 1}T08:00:00.000Z`,
    }))
    const future = {
      ...base,
      reviewId: 'review-future',
      dueAt: '2026-07-30T08:00:00.000Z',
    }
    const overview = createReviewOverview(
      [...dueItems, future],
      [firstSession],
      '2026-07-28T08:00:00.000Z',
    )

    expect(overview.dueItems).toHaveLength(6)
    expect(overview.dueBatch).toHaveLength(5)
    expect(overview.dueBatch[0].item.dueAt).toBe('2026-07-21T08:00:00.000Z')
    expect(overview.upcomingItems).toHaveLength(1)
  })

  it('首次使用变体并与原题稳定交替', () => {
    const session = structuredClone(firstSession)
    session.reviewVariants = [{
      variantId: 'review-priority', title: '新的优先级协商',
      context: '两个项目同时进入关键阶段，你只能在今天完成其中一个，需要向相关负责人说明限制并确认优先级。',
      question: '你会如何协调？', prompt: '选择更清晰的一句话',
      options: choiceCard.options.map((option, index) => ({ ...option, id: `variant-${index}` })),
    }]
    const item = upsertReviewFromTraining([], session, completedProgress(session.sessionId, session.contentVersion, wrongOption.id)).item as ReviewItem
    const firstQuestion = resolveReviewQuestion({ item, session, choiceCard })
    expect(firstQuestion.variantId).toBe('review-priority')
    const recommended = firstQuestion.options.find((option) => option.rating === 'recommended')
    const reviewed = scheduleReviewAnswer(item, session, recommended?.id ?? '', now, firstQuestion.variantId)
    const secondQuestion = resolveReviewQuestion({ item: reviewed?.item as ReviewItem, session, choiceCard })
    expect(secondQuestion.variantId).toBeNull()
    const second = scheduleReviewAnswer(reviewed?.item as ReviewItem, session, correctOption.id, now, null)
    expect(resolveReviewQuestion({ item: second?.item as ReviewItem, session, choiceCard }).variantId).toBe('review-priority')
  })
})
