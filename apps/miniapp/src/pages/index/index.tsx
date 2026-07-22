import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { formatReviewDate } from '../../features/review/review-state'
import { readReviewSnapshot } from '../../features/review/review-snapshot'
import { createCourseOverview } from '../../features/training/training-scheduler'
import {
  transitionTraining,
  type TrainingProgress,
} from '../../features/training/training-state'
import {
  readAllTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

function readHomeSnapshot() {
  const stored = readAllTrainingProgress(trainingContent.sessions)
  const reviews = readReviewSnapshot()
  return {
    overview: createCourseOverview(
      trainingContent.entries,
      stored.progressBySessionId,
    ),
    recoveredSessionIds: stored.recoveredSessionIds,
    reviewOverview: reviews.overview,
    reviewWarning: reviews.recoveredFromInvalid || reviews.writeFailed,
  }
}

export default function Index() {
  const [snapshot, setSnapshot] = useState(readHomeSnapshot)

  useDidShow(() => {
    setSnapshot(readHomeSnapshot())
  })

  const openCourse = () => Taro.navigateTo({ url: '/pages/course/index' })
  const openReviews = () => Taro.navigateTo({ url: '/pages/review/index' })

  const openTraining = async () => {
    const item = snapshot.overview.activeItem
    if (!item?.session || !item.progress) {
      return
    }

    const nextProgress: TrainingProgress = transitionTraining(
      item.progress,
      item.session,
      { type: 'START' },
    )
    writeTrainingProgress(nextProgress)
    setSnapshot(readHomeSnapshot())
    await Taro.navigateTo({
      url: `/pages/training/index?sessionId=${item.session.sessionId}`,
    })
  }

  if (!trainingContent.catalog || trainingContent.sessions.length === 0) {
    return (
      <View className='home-page home-page--centered'>
        <View className='error-card'>
          <Text className='error-card__eyebrow'>内容暂时不可用</Text>
          <Text className='error-card__title'>训练目录没有通过校验</Text>
          <Text className='error-card__body'>我们没有加载未经验证的内容，请稍后重试。</Text>
          <Button
            className='microly-button secondary-button'
            onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}
          >
            重新加载
          </Button>
        </View>
      </View>
    )
  }

  const {
    overview,
    recoveredSessionIds,
    reviewOverview,
    reviewWarning,
  } = snapshot
  const activeItem = overview.activeItem
  const activeSession = activeItem?.session
  const isInProgress = activeItem?.status === 'in_progress'

  return (
    <View className='home-page'>
      <View className='home-hero'>
        <Text className='brand-mark'>微习 MICROLY</Text>
        <Text className='home-hero__title'>今天，练一句更清晰的表达</Text>
        <Text className='home-hero__subtitle'>每天 3 分钟，把知道变成会用。</Text>
      </View>

      {recoveredSessionIds.length > 0 && (
        <View className='notice-banner'>
          部分本地进度无法读取，已为你安全重置。
        </View>
      )}

      {trainingContent.errors.length > 0 && (
        <View className='notice-banner'>
          有 {trainingContent.errors.length} 组内容暂不可用，其他训练仍可继续。
        </View>
      )}

      {reviewWarning && (
        <View className='notice-banner'>部分旧复习数据无法读取，已安全整理。</View>
      )}

      {overview.allCompleted ? (
        <View className='today-card today-card--completed'>
          <View className='today-card__topline'>
            <Text className='today-card__label'>章节已完成</Text>
            <Text className='today-card__duration'>{overview.availableCount} 组训练</Text>
          </View>
          <Text className='today-card__title'>边界沟通训练完成</Text>
          <Text className='today-card__objective'>
            你已经练习了说明边界、协商优先级和管理交付预期。
          </Text>
          <View className='completion-note completion-note--chapter'>
            <Text className='completion-note__icon'>✓</Text>
            <View>
              <Text className='completion-note__title'>
                本章 {overview.completedCount}/{overview.availableCount} 已完成
              </Text>
              <Text className='completion-note__body'>可以查看总结或重新练习任意一组</Text>
            </View>
          </View>
          <Button className='microly-button primary-button' onClick={openCourse}>
            查看全部训练
          </Button>
        </View>
      ) : activeSession && activeItem?.progress ? (
        <View className='today-card'>
          <View className='today-card__topline'>
            <Text className='today-card__label'>
              {isInProgress ? '继续训练' : '下一组训练'}
            </Text>
            <Text className='today-card__duration'>约 {activeSession.estimatedMinutes} 分钟</Text>
          </View>

          <Text className='today-card__title'>{activeSession.title}</Text>
          <Text className='today-card__objective'>{activeSession.objective}</Text>

          <View className='skill-row'>
            <Text className='skill-chip'>边界沟通</Text>
            <Text className='skill-chip'>真实情景</Text>
            <Text className='skill-chip'>主动练习</Text>
          </View>

          <Button className='microly-button primary-button' onClick={openTraining}>
            {isInProgress
              ? `继续练习 · ${activeItem.progress.currentCardIndex + 1}/${activeSession.cards.length}`
              : '开始今天的 3 分钟'}
          </Button>
          <Button className='microly-button text-button' onClick={openCourse}>
            查看全部训练
          </Button>
        </View>
      ) : (
        <View className='error-card'>
          <Text className='error-card__title'>暂时找不到下一组训练</Text>
          <Text className='error-card__body'>请进入课程页查看内容状态。</Text>
          <Button className='microly-button secondary-button' onClick={openCourse}>
            查看全部训练
          </Button>
        </View>
      )}

      {(reviewOverview.dueItems.length > 0 || reviewOverview.upcomingItems.length > 0) && (
        <View className='home-review-card'>
          <View className='home-review-card__content'>
            <Text className='home-review-card__label'>错题复习</Text>
            {reviewOverview.dueItems.length > 0 ? (
              <>
                <Text className='home-review-card__title'>
                  有 {reviewOverview.dueItems.length} 题已经到期
                </Text>
                <Text className='home-review-card__body'>
                  本次约 {Math.max(1, Math.ceil(reviewOverview.dueBatch.length / 2))} 分钟
                </Text>
              </>
            ) : (
              <>
                <Text className='home-review-card__title'>
                  下一次复习：{formatReviewDate(reviewOverview.nextDueAt as string)}
                </Text>
                <Text className='home-review-card__body'>
                  已安排 {reviewOverview.upcomingItems.length} 题，可以提前复习
                </Text>
              </>
            )}
          </View>
          <Button
            className='microly-button microly-button--compact home-review-card__button'
            onClick={openReviews}
          >
            {reviewOverview.dueItems.length > 0 ? '去复习' : '查看错题'}
          </Button>
        </View>
      )}

      <View className='chapter-card'>
        <View>
          <Text className='chapter-card__label'>{trainingContent.catalog.title}</Text>
          <Text className='chapter-card__value'>
            本章进度 {overview.completedCount} / {overview.availableCount}
          </Text>
        </View>
        <View className='chapter-dots'>
          {overview.items.map((item) => (
            <View
              key={item.sessionId}
              className={`chapter-dot chapter-dot--${item.status.replace('_', '-')}`}
            />
          ))}
        </View>
      </View>
    </View>
  )
}
