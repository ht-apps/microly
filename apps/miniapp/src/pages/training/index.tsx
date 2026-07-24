import { useEffect, useRef, useState } from 'react'
import type { AiEvaluation } from '@microly/api-contract'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidHide, useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'

import {
  getFirstAvailableTraining,
  getTrainingEntry,
  getTrainingSession,
  currentTrainingContentBundle,
  trainingContent,
} from '../../data/training-content'
import { flushAnalyticsOutbox, trackEvent } from '../../features/analytics/analytics-client'
import {
  beginActiveTraining,
  finishActiveTraining,
  pauseActiveTraining,
  trackTrainingStart,
  type TrainingEntry,
} from '../../features/analytics/training-analytics'
import { readAccountStatus, upgradeToWechat } from '../../features/account/account-service'
import { shouldPromptWechatLogin } from '../../features/account/login-prompt'
import {
  getAiEvaluation,
  rateAiEvaluation,
  readAiAccessState,
  submitAiEvaluation,
} from '../../features/ai/ai-client'
import type { AiAccessState } from '../../features/ai/ai-access'
import { AI_FOREGROUND_WAIT_MS, remainingAiWaitSeconds } from '../../features/ai/ai-wait'
import { writeCachedAiEvaluations } from '../../features/ai/ai-history-storage'
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
import { flushFullSync } from '../../features/sync/state-sync'
import { isNetworkEnabled } from '../../features/network/network-config'
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
  const [aiAccess, setAiAccess] = useState<AiAccessState>(readAiAccessState)
  const [aiEvaluation, setAiEvaluation] = useState<AiEvaluation | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiWaitUntil, setAiWaitUntil] = useState<number | null>(null)
  const [aiWaitSeconds, setAiWaitSeconds] = useState(0)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const lastCardViewKey = useRef<string | null>(null)
  const initialResume = useRef(false)

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
    initialResume.current = stored.progress.status === 'in_progress' && !router.params.entry
    setRecoveredFromInvalid(stored.recoveredFromInvalid)

    const nextProgress = stored.progress.status === 'not_started'
      ? transitionTraining(
          stored.progress,
          session,
          { type: 'START' },
        )
      : stored.progress

    setProgress(nextProgress)
    trackTrainingStart(session, nextProgress, (router.params.entry as TrainingEntry | undefined) ?? 'direct')
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
    if (!session || !progress || progress.status !== 'in_progress' || reviewCardIndex !== null) return
    const card = session.cards[progress.currentCardIndex]
    if (!card) return
    const key = `${progress.attemptId}:${progress.currentCardIndex}`
    beginActiveTraining(progress.attemptId)
    if (lastCardViewKey.current !== key) {
      trackEvent('training_card_view', {
        attemptId: progress.attemptId,
        sessionId: session.sessionId,
        releaseVersion: currentTrainingContentBundle.releaseVersion,
        contentVersion: session.contentVersion,
        cardId: card.id,
        cardType: card.type,
        cardIndex: progress.currentCardIndex,
        isResume: initialResume.current,
      })
      lastCardViewKey.current = key
      initialResume.current = false
      void flushAnalyticsOutbox()
    }
    return () => { pauseActiveTraining(progress.attemptId) }
  }, [progress?.attemptId, progress?.currentCardIndex, progress?.status, reviewCardIndex, session])

  useDidHide(() => {
    if (progress?.status === 'in_progress') pauseActiveTraining(progress.attemptId)
  })
  useDidShow(() => {
    if (progress?.status === 'in_progress' && reviewCardIndex === null) beginActiveTraining(progress.attemptId)
  })

  useEffect(() => {
    if (process.env.TARO_ENV !== 'weapp') return
    const shouldShowShare = progress?.status === 'completed'
      && reviewCardIndex === null
    const updateMenu = shouldShowShare
      ? Taro.showShareMenu({})
      : Taro.hideShareMenu()
    updateMenu.catch(() => undefined)
  }, [progress?.status, reviewCardIndex])

  useEffect(() => {
    const evaluation = aiEvaluation
    if (!evaluation || !['queued', 'processing'].includes(evaluation.status)) return
    const pollTimer = setInterval(() => {
      void getAiEvaluation(evaluation.id).then((next) => {
        if (!next) return
        setAiEvaluation(next)
        writeCachedAiEvaluations([next])
        if (!['queued', 'processing'].includes(next.status)) {
          setAiBusy(false)
          setAiWaitUntil(null)
          setAiWaitSeconds(0)
          setAiMessage(next.status === 'succeeded' ? null : 'AI 服务暂时不可用，已展示安全的本地结构检查。')
          trackEvent('ai_evaluation', {
            sessionId: next.sessionId,
            status: next.status === 'succeeded' ? 'succeeded' : next.status === 'blocked' ? 'blocked' : next.status === 'canceled' ? 'canceled' : 'degraded',
            modelConfigRevision: next.result?.model?.configRevision,
            latencyMs: next.latencyMs ?? undefined,
          })
          void flushAnalyticsOutbox()
        }
      })
    }, 2000)
    return () => clearInterval(pollTimer)
  }, [aiEvaluation?.id, aiEvaluation?.status])

  useEffect(() => {
    if (aiWaitUntil === null) return
    const updateRemaining = () => {
      const remaining = remainingAiWaitSeconds(aiWaitUntil)
      setAiWaitSeconds(remaining)
      if (remaining === 0) {
        setAiWaitUntil(null)
        setAiMessage('AI 仍在生成，你可以先完成训练，稍后在复习页查看。')
      }
    }
    updateRemaining()
    const timer = setInterval(updateRemaining, 250)
    return () => clearInterval(timer)
  }, [aiWaitUntil])

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
            attemptId: current.attemptId,
            sessionId: session.sessionId,
            releaseVersion: currentTrainingContentBundle.releaseVersion,
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
        trackEvent('training_complete', {
          attemptId: nextProgress.attemptId,
          sessionId: session.sessionId,
          releaseVersion: currentTrainingContentBundle.releaseVersion,
          contentVersion: session.contentVersion,
          durationMs: finishActiveTraining(nextProgress.attemptId),
          practiceUsed: Boolean(nextProgress.practiceEvaluation),
        })
        enqueueTrainingCompletion(nextProgress)
        void flushCompletionOutbox()
        void flushFullSync()
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
        const prompted = Taro.getStorageSync('microly:account:login-prompted:v1')
        if (shouldPromptWechatLogin({
          prompted: Boolean(prompted),
          networkEnabled: isNetworkEnabled(),
          authType: readAccountStatus().authType,
        })) {
          Taro.setStorageSync('microly:account:login-prompted:v1', true)
          trackEvent('login_prompt', { entry: 'training_complete' })
          void Taro.showModal({
            title: '保留这次学习',
            content: '登录微信后，可在其他设备恢复进度、收藏和复习计划。',
            confirmText: '去登录',
            cancelText: '稍后',
          }).then((result) => {
            if (result.confirm) Taro.navigateTo({ url: '/pages/settings/index' })
          })
        }
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
    void flushFullSync()
  }

  const requestAiEvaluation = async () => {
    if (!session || !progress || aiBusy) return
    const card = session.cards.find((item) => item.type === 'practice')
    if (!card || progress.practiceText.trim().length < card.minLength) return
    applyAction({ type: 'SUBMIT_PRACTICE' })
    setAiBusy(true)
    setAiMessage('正在安全提交，原文不会保存到云端。')
    const response = await submitAiEvaluation(session, card, progress)
    if (response.evaluation) {
      setAiEvaluation(response.evaluation)
      writeCachedAiEvaluations([response.evaluation])
      trackEvent('ai_evaluation', { sessionId: session.sessionId, status: 'submitted' })
      void flushAnalyticsOutbox()
      if (['queued', 'processing'].includes(response.evaluation.status)) {
        const waitUntil = Date.now() + AI_FOREGROUND_WAIT_MS
        setAiWaitUntil(waitUntil)
        setAiWaitSeconds(remainingAiWaitSeconds(waitUntil))
      } else {
        setAiBusy(false)
        setAiWaitUntil(null)
        setAiWaitSeconds(0)
      }
      setAiMessage(response.evaluation.status === 'blocked' ? '请移除敏感或高风险信息后再试。' : null)
      if (response.evaluation.status === 'blocked') {
        trackEvent('ai_evaluation', { sessionId: session.sessionId, status: 'blocked' })
        void flushAnalyticsOutbox()
      }
      return
    }
    setAiBusy(false)
    const message = response.errorCode === 'ai_quota_exceeded'
      ? '今天的 AI 点评额度已用完，已使用本地结构检查。'
      : response.errorCode === 'wechat_login_required'
        ? '微信登录已失效，请重新登录。'
        : '联网点评暂时不可用，已使用本地结构检查。'
    setAiMessage(message)
    if (response.errorCode === 'ai_quota_exceeded') {
      trackEvent('ai_evaluation', { sessionId: session.sessionId, status: 'quota_exceeded' })
      void flushAnalyticsOutbox()
    }
  }

  const loginAndRequestAi = async () => {
    setAiBusy(true)
    const loggedIn = await upgradeToWechat()
    setAiBusy(false)
    if (!loggedIn) {
      setAiMessage('微信登录没有完成，仍可使用本地结构检查。')
      return
    }
    setAiAccess('ready')
    await requestAiEvaluation()
  }

  const rateEvaluation = async (helpful: boolean) => {
    if (!aiEvaluation) return
    const updated = await rateAiEvaluation(aiEvaluation.id, helpful, helpful ? 'actionable' : 'too_generic')
    if (updated) {
      setAiEvaluation(updated)
      trackEvent('ai_evaluation_rating', { helpful })
      void flushAnalyticsOutbox()
    }
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

  const openCurrentCourse = () => Taro.switchTab({ url: '/pages/course/index' })
  const backToday = () => Taro.switchTab({ url: '/pages/index/index' })

  if (!session || !progress) {
    const errorBody = requestedEntry?.error
      ?? (requestedSessionId
        ? '这组训练可能已经更新或下架，历史学习记录仍会保留。'
        : '当前没有可用的训练内容。')

    return (
      <View className='training-page training-page--centered'>
        <View className='training-error'>
          <Text className='card-eyebrow'>内容暂时不可用</Text>
          <Text className='card-title'>{requestedSessionId ? '这组训练已不可用' : '训练内容没有通过校验'}</Text>
          <Text className='training-error__body'>{errorBody}</Text>
          <Button className='microly-button training-primary-button' onClick={openCurrentCourse}>
            查看当前课程
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
              ? '部分收藏数据无法读取，已安全整理。'
            : storageWarning
              ? '当前进度暂时无法保存，请保持页面开启。'
              : '本地进度无法读取，已从头开始。'}
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
          aiEvaluation={aiEvaluation}
          aiBusy={aiBusy}
          aiWaitSeconds={aiWaitSeconds}
          aiMessage={aiMessage}
          aiAccess={aiAccess}
          onRequestAi={requestAiEvaluation}
          onLoginForAi={loginAndRequestAi}
          onRateAi={rateEvaluation}
        />
      )}
    </View>
  )
}
