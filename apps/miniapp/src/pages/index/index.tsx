import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { createLearningActivitySummary } from '../../features/activity/activity-state'
import { syncLearningActivity } from '../../features/activity/activity-storage'
import { readPreferenceSnapshot } from '../../features/preference/preference-snapshot'
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
  const activity = syncLearningActivity(
    trainingContent.sessions,
    stored.progressBySessionId,
  )
  const preference = readPreferenceSnapshot()
  return {
    overview: createCourseOverview(
      trainingContent.chapters,
      stored.progressBySessionId,
    ),
    recoveredSessionIds: stored.recoveredSessionIds,
    reviewOverview: reviews.overview,
    reviewWarning: reviews.recoveredFromInvalid || reviews.writeFailed,
    activitySummary: createLearningActivitySummary(activity.events),
    activityWarning: activity.recoveredFromInvalid || activity.writeFailed,
    preference,
  }
}

export default function Index() {
  const [snapshot, setSnapshot] = useState(readHomeSnapshot)

  useDidShow(() => {
    setSnapshot(readHomeSnapshot())
  })

  const openCourse = () => Taro.switchTab({ url: '/pages/course/index' })
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

  const library = trainingContent.library
  if (!library || trainingContent.sessions.length === 0) {
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
    activitySummary,
    activityWarning,
    preference,
  } = snapshot
  const activeItem = overview.activeItem
  const activeChapter = overview.activeChapter
  const activeSession = activeItem?.session
  const isInProgress = activeItem?.status === 'in_progress'
  const progressChapter = activeChapter
    ?? overview.chapters[overview.chapters.length - 1]
  const todayCompletedSession = trainingContent.sessions.find(
    (session) => session.sessionId === activitySummary.todayCompletedSessionId,
  )
  const activeChapterIsPreferred = activeChapter
    ? preference.selectedCatalogIds.includes(activeChapter.catalogId)
    : false

  return (
    <View className='home-page'>
      <View className='home-hero'>
        <Text className='brand-mark'>微习 MICROLY</Text>
        <Text className='home-hero__title'>今天，练一句更清晰的表达</Text>
        <Text className='home-hero__subtitle'>每天 3 分钟，把知道变成会用。</Text>
      </View>

      {preference.selectedCatalogs.length > 0 && (
        <View className='home-preference'>
          <Text className='home-preference__label'>重点提升</Text>
          <View className='home-preference__chips'>
            {preference.selectedCatalogs.map((catalog) => (
              <Text key={catalog.catalogId} className='home-preference__chip'>
                {catalog.title}
              </Text>
            ))}
          </View>
        </View>
      )}

      {recoveredSessionIds.length > 0 && (
        <View className='notice-banner'>
          部分本地进度无法读取，已为你安全重置。
        </View>
      )}

      {trainingContent.errors.length > 0 && (
        <View className='notice-banner'>
          有 {trainingContent.errors.length} 项内容暂不可用，其他训练仍可继续。
        </View>
      )}

      {reviewWarning && (
        <View className='notice-banner'>部分旧复习数据无法读取，已安全整理。</View>
      )}

      {activityWarning && (
        <View className='notice-banner'>部分本地学习日记录无法读取，已安全整理。</View>
      )}

      {(preference.recoveredFromInvalid || preference.writeFailed) && (
        <View className='notice-banner'>部分学习偏好无法读取，已安全整理。</View>
      )}

      {overview.allCompleted ? (
        <View className='today-card today-card--completed'>
          <View className='today-card__topline'>
            <Text className='today-card__label'>课程已完成</Text>
            <Text className='today-card__duration'>{overview.availableCount} 组训练</Text>
          </View>
          <Text className='today-card__title'>{library.title}完成</Text>
          <Text className='today-card__objective'>
            {library.description}
          </Text>
          <View className='completion-note completion-note--chapter'>
            <Text className='completion-note__icon'>✓</Text>
            <View>
              <Text className='completion-note__title'>
                全课程 {overview.completedCount}/{overview.availableCount} 已完成
              </Text>
              <Text className='completion-note__body'>可以查看总结或重新练习任意一组</Text>
            </View>
          </View>
          <Button className='microly-button primary-button' onClick={openCourse}>
            查看全部训练
          </Button>
        </View>
      ) : activitySummary.todayTrainingCompleted && !isInProgress ? (
        <View className='today-card today-card--daily-completed'>
          <View className='today-card__topline'>
            <Text className='today-card__label'>今日已完成</Text>
            <Text className='today-card__duration'>今天的 3 分钟</Text>
          </View>
          <Text className='today-card__title'>
            {todayCompletedSession?.title ?? '今天的训练'}已完成
          </Text>
          <Text className='today-card__objective'>
            {todayCompletedSession?.objective ?? '今天已经完成一组正式训练。'}
          </Text>
          <View className='completion-note completion-note--chapter'>
            <Text className='completion-note__icon'>✓</Text>
            <View>
              <Text className='completion-note__title'>今天的学习已经记下</Text>
              <Text className='completion-note__body'>保持轻量，明天再继续也很好</Text>
            </View>
          </View>
          {activeSession && (
            <View className='next-preview'>
              <Text className='next-preview__label'>下一组预告</Text>
              <Text className='next-preview__title'>{activeSession.title}</Text>
              <Text className='next-preview__body'>{activeSession.objective}</Text>
            </View>
          )}
          <Button className='microly-button primary-button' onClick={openCourse}>
            查看课程
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
            <Text className='skill-chip'>{activeChapter?.catalog?.title ?? '职场沟通'}</Text>
            {activeChapterIsPreferred && <Text className='skill-chip'>你的重点</Text>}
            <Text className='skill-chip'>真实情景</Text>
            <Text className='skill-chip'>主动练习</Text>
          </View>

          {preference.selectedCatalogs.length > 0 && !activeChapterIsPreferred && (
            <Text className='preference-guidance'>
              当前先完成课程基础，之后会进入你的重点：{preference.summary}
            </Text>
          )}

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

      <View className='week-card'>
        <View className='week-card__topline'>
          <View>
            <Text className='week-card__label'>本周学习</Text>
            <Text className='week-card__title'>
              {activitySummary.weekEffectiveDayCount} / 7 个有效学习日
            </Text>
          </View>
          <Text className='week-card__streak'>连续 {activitySummary.currentStreak} 天</Text>
        </View>
        <View className='week-days'>
          {activitySummary.weekDays.map((day) => (
            <View key={day.dateKey} className='week-day'>
              <Text className='week-day__label'>{day.label}</Text>
              <View
                className={`week-day__dot ${day.isEffective ? 'week-day__dot--effective' : ''} ${day.isToday ? 'week-day__dot--today' : ''} ${day.isFuture ? 'week-day__dot--future' : ''}`}
              >
                {day.isEffective ? '✓' : ''}
              </View>
            </View>
          ))}
        </View>
        <Text className='week-card__hint'>
          完成一组训练，或同一天完成 2 道到期复习，即记为有效学习日。
        </Text>
      </View>

      {progressChapter && (
        <View className='chapter-card'>
          <View>
            <Text className='chapter-card__label'>
              {progressChapter.catalog?.title ?? '章节内容暂不可用'}
            </Text>
            <Text className='chapter-card__value'>
              本章进度 {progressChapter.completedCount} / {progressChapter.availableCount}
            </Text>
          </View>
          <View className='chapter-dots'>
            {progressChapter.items.map((item) => (
              <View
                key={item.sessionId}
                className={`chapter-dot chapter-dot--${item.status.replace('_', '-')}`}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  )
}
