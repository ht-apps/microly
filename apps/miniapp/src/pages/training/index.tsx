import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'

import {
  getFirstAvailableTraining,
  getTrainingEntry,
  getTrainingSession,
  trainingContent,
} from '../../data/training-content'
import { flushAnalyticsOutbox, trackEvent } from '../../features/analytics/analytics-client'
import { createTrainingCompletedEvent } from '../../features/activity/activity-state'
import { recordLearningActivity } from '../../features/activity/activity-storage'
import {
  CHALLENGE_SHARE_IMAGE_URL,
  createChallengeSharePayload,
} from '../../features/challenge/challenge-share'
import { isSessionFavorite } from '../../features/favorite/favorite-state'
import {
  setSessionFavorite,
  syncFavoriteQueue,
} from '../../features/favorite/favorite-storage'
import {
  readReviewQueue,
  upsertCompletedTrainingReview,
} from '../../features/review/review-storage'
import {
  enqueueTrainingCompletion,
  flushCompletionOutbox,
} from '../../features/sync/completion-sync'
import TrainingCardRenderer, {
  CompletedTrainingReview,
} from '../../features/training/TrainingCardRenderer'
import {
  transitionTraining,
  type TrainingAction,
  type TrainingProgress,
} from '../../features/training/training-state'
import {
  readTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

export default function TrainingPage() {
  const router = useRouter()
  const requestedSessionId = router.params.sessionId
  const fallbackSession = getFirstAvailableTraining()
  const session = requestedSessionId
    ? getTrainingSession(requestedSessionId)
    : fallbackSession
  const requestedEntry = requestedSessionId
    ? getTrainingEntry(requestedSessionId)
    : undefined
  const [progress, setProgress] = useState<TrainingProgress | null>(() =>
    session
      ? readTrainingProgress(session).progress
      : null,
  )
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [favoriteStorageWarning, setFavoriteStorageWarning] = useState(false)
  const [favoriteRecoveredFromInvalid, setFavoriteRecoveredFromInvalid] = useState(false)
  const [isPrincipleFavorite, setIsPrincipleFavorite] = useState(false)
  const [reviewDueAt, setReviewDueAt] = useState<string | null>(null)
  const [reviewCardIndex, setReviewCardIndex] = useState<number | null>(null)
  const [activityStorageWarning, setActivityStorageWarning] = useState(false)

  useShareAppMessage(() => (
    session
      ? createChallengeSharePayload(session)
      : {
          title: '一句话情景挑战｜微习 Microly',
          path: '/pages/onboarding/index',
          imageUrl: CHALLENGE_SHARE_IMAGE_URL,
        }
  ))

  useEffect(() => {
    if (!session) {
      return
    }

    setReviewCardIndex(null)
    Taro.setNavigationBarTitle({ title: session.title })
    const stored = readTrainingProgress(session)
    setRecoveredFromInvalid(stored.recoveredFromInvalid)

    const nextProgress = stored.progress.status === 'not_started'
      ? transitionTraining(
          stored.progress,
          session,
          { type: 'START' },
        )
      : stored.progress

    setProgress(nextProgress)
    const storedFavorites = syncFavoriteQueue(trainingContent.sessions)
    setIsPrincipleFavorite(isSessionFavorite(storedFavorites.items, session))
    if (storedFavorites.recoveredFromInvalid) setFavoriteRecoveredFromInvalid(true)
    if (storedFavorites.writeFailed) setFavoriteStorageWarning(true)
    const storedReviews = readReviewQueue(trainingContent.sessions)
    if (storedReviews.recoveredFromInvalid) setStorageWarning(true)
    const existingReview = storedReviews.items.find(
      (item) => item.sessionId === session.sessionId,
    )
    setReviewDueAt(existingReview?.dueAt ?? null)
    if (!writeTrainingProgress(nextProgress)) {
      setStorageWarning(true)
    }
  }, [session])

  useEffect(() => {
    if (process.env.TARO_ENV !== 'weapp') return
    const shouldShowShare = progress?.status === 'completed'
      && reviewCardIndex === null
    const updateMenu = shouldShowShare
      ? Taro.showShareMenu({})
      : Taro.hideShareMenu()
    updateMenu.catch(() => undefined)
  }, [progress?.status, reviewCardIndex])

  const applyAction = (action: TrainingAction) => {
    if (!session) {
      return
    }

    setProgress((current) => {
      if (!current) {
        return current
      }

      if (action.type === 'CONFIRM_CHOICE' && current.selectedOptionId) {
        const choice = session.cards.find((card) => card.type === 'choice')
        const displayPosition = choice?.options.findIndex(
          (option) => option.id === current.selectedOptionId,
        ) ?? -1
        const option = choice?.options[displayPosition]
        if (option && displayPosition >= 0) {
          trackEvent('option_select', {
            sessionId: session.sessionId,
            contentVersion: session.contentVersion,
            optionId: option.id,
            displayPosition,
            rating: option.rating,
          })
          void flushAnalyticsOutbox()
        }
      }

      const nextProgress = transitionTraining(
        current,
        session,
        action,
      )
      if (nextProgress !== current && !writeTrainingProgress(nextProgress)) {
        setStorageWarning(true)
      }
      if (
        action.type === 'COMPLETE'
        && current.status !== 'completed'
        && nextProgress.status === 'completed'
      ) {
        const startedAt = nextProgress.startedAt
        const completedAt = nextProgress.completedAt
        trackEvent('training_complete', {
          sessionId: session.sessionId,
          contentVersion: session.contentVersion,
          durationMs: startedAt && completedAt
            ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
            : 0,
          practiceUsed: Boolean(nextProgress.practiceEvaluation),
        })
        enqueueTrainingCompletion(nextProgress)
        void flushCompletionOutbox()
        void flushAnalyticsOutbox()
        if (nextProgress.completedAt) {
          const activity = recordLearningActivity(
            trainingContent.sessions,
            createTrainingCompletedEvent(
              session.sessionId,
              nextProgress.completedAt,
            ),
          )
          if (activity.writeFailed || activity.recoveredFromInvalid) {
            setActivityStorageWarning(true)
          }
        }
        const review = upsertCompletedTrainingReview(
          trainingContent.sessions,
          session,
          nextProgress,
        )
        setReviewDueAt(review.item?.dueAt ?? null)
        if (review.writeFailed) setStorageWarning(true)
      }
      return nextProgress
    })
  }

  const toggleFavorite = () => {
    if (!session) return
    const nextValue = !isPrincipleFavorite
    const result = setSessionFavorite(
      trainingContent.sessions,
      session,
      nextValue,
    )
    if (result.writeFailed) {
      setFavoriteStorageWarning(true)
      return
    }
    if (result.recoveredFromInvalid) setFavoriteRecoveredFromInvalid(true)
    setFavoriteStorageWarning(false)
    setIsPrincipleFavorite(result.isFavorite)
  }

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

  const backToday = () => Taro.switchTab({ url: '/pages/index/index' })

  if (!session || !progress) {
    const errorBody = requestedEntry?.error
      ?? (requestedSessionId
        ? '没有找到这组训练，请从课程页重新进入。'
        : '当前没有可用的训练内容。')

    return (
      <View className='training-page training-page--centered'>
        <View className='training-error'>
          <Text className='card-eyebrow'>内容暂时不可用</Text>
          <Text className='card-title'>训练内容没有通过校验</Text>
          <Text className='training-error__body'>{errorBody}</Text>
          <Button className='microly-button training-primary-button' onClick={backToday}>
            返回首页
          </Button>
        </View>
      </View>
    )
  }

  const isReviewing = reviewCardIndex !== null
  const visibleCardIndex = reviewCardIndex ?? progress.currentCardIndex
  const visibleCardCount = isReviewing ? 5 : session.cards.length
  const progressPercent = ((visibleCardIndex + 1) / visibleCardCount) * 100

  const leaveReview = () => setReviewCardIndex(null)
  const showPreviousReviewCard = () => {
    setReviewCardIndex((current) => (
      current === null ? null : Math.max(0, current - 1)
    ))
  }
  const showNextReviewCard = () => {
    setReviewCardIndex((current) => (
      current === null || current >= 4 ? null : current + 1
    ))
  }

  return (
    <View className='training-page'>
      <View className='training-toolbar'>
        <Button
          className='microly-button exit-button'
          onClick={isReviewing ? leaveReview : returnToEntry}
        >
          {isReviewing ? '退出回看' : '退出'}
        </Button>
        <Text className='training-toolbar__step'>
          {isReviewing ? '回看 ' : ''}{visibleCardIndex + 1} / {visibleCardCount}
        </Text>
      </View>
      <View className='progress-track'>
        <View
          className='progress-track__value'
          style={{ width: `${progressPercent}%` }}
        />
      </View>

      {(recoveredFromInvalid
        || storageWarning
        || favoriteStorageWarning
        || favoriteRecoveredFromInvalid
        || activityStorageWarning) && (
        <View className='training-notice'>
          {activityStorageWarning
            ? '本次学习已完成，但学习日记录暂时无法保存。'
            : favoriteStorageWarning
            ? '收藏暂时无法保存，其他训练内容不受影响。'
            : favoriteRecoveredFromInvalid
              ? '部分旧收藏无法读取，已安全整理。'
            : storageWarning
              ? '当前进度暂时无法保存，请保持页面开启。'
              : '旧的本地进度无法读取，已从头开始。'}
        </View>
      )}

      {reviewCardIndex !== null ? (
        <CompletedTrainingReview
          session={session}
          progress={progress}
          cardIndex={reviewCardIndex}
          onPrevious={showPreviousReviewCard}
          onNext={showNextReviewCard}
        />
      ) : (
        <TrainingCardRenderer
          session={session}
          progress={progress}
          onAction={applyAction}
          onBackHome={backToday}
          onStartReview={() => setReviewCardIndex(0)}
          isPrincipleFavorite={isPrincipleFavorite}
          onToggleFavorite={toggleFavorite}
          onShareUnavailable={() => Taro.showToast({
            title: '请在微信小程序中使用分享',
            icon: 'none',
          })}
          reviewDueAt={reviewDueAt}
        />
      )}
    </View>
  )
}
