import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { readLearningActivitySnapshot } from '../../features/activity/activity-snapshot'
import { createDueReviewAnsweredEvent } from '../../features/activity/activity-state'
import { recordLearningActivity } from '../../features/activity/activity-storage'
import {
  findTrainingOption,
  formatReviewDate,
  type ResolvedReviewItem,
} from '../../features/review/review-state'
import { readReviewSnapshot } from '../../features/review/review-snapshot'
import { saveReviewAnswer } from '../../features/review/review-storage'
import {
  createReviewRunState,
  transitionReviewRun,
} from '../../features/review/review-run-state'

import './index.scss'

type ReviewView = 'overview' | 'quiz' | 'summary'

export default function ReviewPage() {
  const [snapshot, setSnapshot] = useState(() => readReviewSnapshot())
  const [view, setView] = useState<ReviewView>('overview')
  const [runItems, setRunItems] = useState<ResolvedReviewItem[]>([])
  const [runState, setRunState] = useState(createReviewRunState)
  const [storageWarning, setStorageWarning] = useState(false)
  const [countedDueReviewCount, setCountedDueReviewCount] = useState(0)
  const [activitySummary, setActivitySummary] = useState(
    () => readLearningActivitySnapshot().summary,
  )

  const returnToEntry = async () => {
    try {
      if (Taro.getCurrentPages().length > 1) {
        await Taro.navigateBack()
        return
      }
    } catch {
      // Fall through to the safe tab route.
    }
    await Taro.switchTab({ url: '/pages/index/index' })
  }

  useDidShow(() => {
    if (view === 'overview') setSnapshot(readReviewSnapshot())
  })

  const startReview = (items: ResolvedReviewItem[]) => {
    if (items.length === 0) return
    setRunItems(items)
    setCountedDueReviewCount(0)
    setRunState(transitionReviewRun(
      createReviewRunState(),
      { type: 'START', itemCount: items.length },
    ))
    setView('quiz')
  }

  const activeEntry = runItems[runState.currentIndex]

  const confirmAnswer = () => {
    if (
      !activeEntry
      || !runState.selectedOptionId
      || runState.answerConfirmed
    ) return
    const answeredAt = new Date().toISOString()
    const saved = saveReviewAnswer(
      trainingContent.sessions,
      activeEntry.item,
      activeEntry.session,
      runState.selectedOptionId,
      answeredAt,
    )
    if (!saved.result) return

    if (saved.writeFailed || saved.recoveredFromInvalid) {
      setStorageWarning(true)
    }
    const activityEvent = createDueReviewAnsweredEvent(
      activeEntry.item,
      answeredAt,
    )
    if (activityEvent) {
      const activity = recordLearningActivity(
        trainingContent.sessions,
        activityEvent,
      )
      setCountedDueReviewCount((count) => count + 1)
      if (activity.writeFailed || activity.recoveredFromInvalid) {
        setStorageWarning(true)
      }
    }
    setRunState((state) => transitionReviewRun(state, {
      type: 'CONFIRM',
      isCorrect: saved.result?.isCorrect ?? false,
    }))
  }

  const advance = () => {
    const nextState = transitionReviewRun(runState, { type: 'NEXT' })
    setRunState(nextState)
    if (!nextState.completed) {
      return
    }

    setSnapshot(readReviewSnapshot())
    setActivitySummary(readLearningActivitySnapshot().summary)
    setView('summary')
  }

  if (view === 'quiz' && activeEntry) {
    const { session, choiceCard } = activeEntry
    const scenarioCard = session.cards.find((card) => card.type === 'scenario')
    const selectedOption = findTrainingOption(session, runState.selectedOptionId)
    const recommendedOption = choiceCard.options.find(
      (option) => option.rating === 'recommended',
    )

    return (
      <View className='review-page'>
        <View className='review-toolbar'>
          <Text className='review-toolbar__label'>错题复习</Text>
          <Text className='review-toolbar__step'>
            {runState.currentIndex + 1}/{runItems.length}
          </Text>
        </View>

        {storageWarning && (
          <View className='review-notice'>复习结果暂时无法完整保存，请保持页面开启。</View>
        )}

        <View className='review-quiz-card'>
          <Text className='review-eyebrow'>{session.title}</Text>
          <Text className='review-title'>{scenarioCard?.title ?? choiceCard.prompt}</Text>
          {scenarioCard && (
            <Text className='review-context'>{scenarioCard.context}</Text>
          )}
          <Text className='review-question'>{choiceCard.prompt}</Text>

          <View className='review-option-list'>
            {choiceCard.options.map((option, index) => {
              const isSelected = option.id === runState.selectedOptionId
              return (
                <Button
                  key={option.id}
                  className={`microly-button review-option ${isSelected ? 'review-option--selected' : ''}`}
                  aria-disabled={runState.answerConfirmed}
                  onClick={() => {
                    setRunState((state) => transitionReviewRun(state, {
                      type: 'SELECT',
                      optionId: option.id,
                    }))
                  }}
                >
                  <Text className='review-option__index'>
                    {String.fromCharCode(65 + index)}
                  </Text>
                  <Text className='review-option__text'>{option.text}</Text>
                </Button>
              )
            })}
          </View>

          {!runState.answerConfirmed ? (
            <Button
              className='microly-button review-primary-button'
              disabled={!runState.selectedOptionId}
              onClick={confirmAnswer}
            >
              确认回答
            </Button>
          ) : (
            <>
              <View className={`review-feedback ${runState.lastAnswerCorrect ? 'review-feedback--correct' : ''}`}>
                <Text className='review-feedback__result'>
                  {runState.lastAnswerCorrect ? '这次判断更清晰' : '这次还可以再巩固'}
                </Text>
                <Text className='review-feedback__body'>
                  {selectedOption?.feedback.interpretation}
                </Text>
                {!runState.lastAnswerCorrect && (
                  <Text className='review-feedback__risk'>
                    需要留意：{selectedOption?.feedback.risk}
                  </Text>
                )}
                <View className='review-reference'>
                  <Text className='review-reference__label'>更推荐的表达</Text>
                  <Text className='review-reference__text'>{recommendedOption?.text}</Text>
                </View>
              </View>
              <Button className='microly-button review-primary-button' onClick={advance}>
                {runState.currentIndex < runItems.length - 1 ? '下一题' : '完成复习'}
              </Button>
            </>
          )}
        </View>
      </View>
    )
  }

  if (view === 'summary') {
    const todayEffective = activitySummary.todayEffective
      || countedDueReviewCount >= 2

    return (
      <View className='review-page review-page--centered'>
        <View className='review-summary'>
          <View className='review-summary__check'>✓</View>
          <Text className='review-title'>本次复习完成</Text>
          <Text className='review-summary__body'>
            你完成了 {runItems.length} 题，其中 {runState.correctCount} 题选择了更推荐的表达。
          </Text>
          <View className='review-activity-note'>
            <Text className='review-activity-note__title'>
              本次计入 {countedDueReviewCount} 道到期复习
            </Text>
            <Text className='review-activity-note__body'>
              {todayEffective
                ? '今天已形成一个有效学习日。'
                : '同一天完成 2 道到期复习，可计入本周学习。'}
            </Text>
          </View>
          {snapshot.overview.nextDueAt && (
            <View className='review-next-date'>
              下一次复习：{formatReviewDate(snapshot.overview.nextDueAt)}
            </View>
          )}
          <Button
            className='microly-button review-primary-button'
            onClick={returnToEntry}
          >
            回到今日
          </Button>
          <Button
            className='microly-button review-text-button'
            onClick={() => setView('overview')}
          >
            查看复习队列
          </Button>
        </View>
      </View>
    )
  }

  const { dueItems, dueBatch, upcomingItems } = snapshot.overview
  const hasReviews = dueItems.length > 0 || upcomingItems.length > 0

  return (
    <View className='review-page'>
      <View className='review-hero'>
        <Text className='review-eyebrow'>间隔复习</Text>
        <Text className='review-title'>把容易忘的表达再练一次</Text>
        <Text className='review-hero__body'>每题约 30 秒，答完会自动安排下一次复习。</Text>
      </View>

      {(
        snapshot.recoveredFromInvalid
        || snapshot.trainingProgressRecovered
        || snapshot.writeFailed
      ) && (
        <View className='review-notice'>部分旧复习数据无法读取，已安全整理。</View>
      )}

      {!hasReviews && (
        <View className='review-empty'>
          <Text className='review-empty__title'>暂时没有错题</Text>
          <Text className='review-empty__body'>训练中选择“不建议”的表达后，会在这里安排复习。</Text>
          <Button
            className='microly-button review-secondary-button'
            onClick={returnToEntry}
          >
            返回今日
          </Button>
        </View>
      )}

      {dueItems.length > 0 && (
        <View className='review-section'>
          <View className='review-section__topline'>
            <Text className='review-section__title'>今日到期</Text>
            <Text className='review-section__count'>{dueItems.length} 题</Text>
          </View>
          <Text className='review-section__body'>本次最多复习 {dueBatch.length} 题。</Text>
          <Button
            className='microly-button review-primary-button'
            onClick={() => startReview(dueBatch)}
          >
            开始复习 · 约 {Math.max(1, Math.ceil(dueBatch.length / 2))} 分钟
          </Button>
        </View>
      )}

      {upcomingItems.length > 0 && (
        <View className='review-section'>
          <View className='review-section__topline'>
            <Text className='review-section__title'>稍后复习</Text>
            <Text className='review-section__count'>{upcomingItems.length} 题</Text>
          </View>
          <View className='review-upcoming-list'>
            {upcomingItems.map((entry) => (
              <View key={entry.item.reviewId} className='review-upcoming-item'>
                <View className='review-upcoming-item__content'>
                  <Text className='review-upcoming-item__title'>{entry.session.title}</Text>
                  <Text className='review-upcoming-item__date'>
                    计划 {formatReviewDate(entry.item.dueAt)}复习
                  </Text>
                </View>
                <Button
                  className='microly-button microly-button--compact review-early-button'
                  onClick={() => startReview([entry])}
                >
                  提前复习
                </Button>
              </View>
            ))}
          </View>
          <Text className='review-early-note'>
            提前复习属于额外巩固，不计入本周有效学习日。
          </Text>
        </View>
      )}
    </View>
  )
}
