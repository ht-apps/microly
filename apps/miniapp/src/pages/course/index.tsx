import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import { trainingContent } from '../../data/training-content'
import { trackTrainingStart } from '../../features/analytics/training-analytics'
import { subscribeToContentUpdates } from '../../features/content/content-client'
import { readPreferenceSnapshot } from '../../features/preference/preference-snapshot'
import { formatReviewDate } from '../../features/review/review-state'
import { readReviewSnapshot } from '../../features/review/review-snapshot'
import {
  createCourseOverview,
  type CourseChapterStatus,
  type CourseItem,
  type CourseItemStatus,
} from '../../features/training/course-overview'
import { transitionTraining } from '../../features/training/training-state'
import {
  clearTrainingProgress,
  readAllTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

const statusLabels: Record<CourseItemStatus, string> = {
  unavailable: '内容暂不可用',
  locked: '完成上一组后解锁',
  not_started: '可以开始',
  in_progress: '进行中',
  completed: '已完成',
}

const chapterStatusLabels: Record<CourseChapterStatus, string> = {
  unavailable: '内容暂不可用',
  locked: '尚未解锁',
  not_started: '可以开始',
  in_progress: '学习中',
  completed: '已完成',
}

function readCourseSnapshot() {
  const stored = readAllTrainingProgress(trainingContent.sessions)
  const reviews = readReviewSnapshot()
  const preference = readPreferenceSnapshot()
  return {
    overview: createCourseOverview(
      trainingContent.chapters,
      stored.progressBySessionId,
    ),
    recoveredSessionIds: stored.recoveredSessionIds,
    reviewOverview: reviews.overview,
    reviewWarning: reviews.recoveredFromInvalid || reviews.writeFailed,
    preference,
  }
}

function trainingUrl(sessionId: string) {
  return `/pages/training/index?sessionId=${sessionId}&entry=course`
}

export default function CoursePage() {
  const [snapshot, setSnapshot] = useState(readCourseSnapshot)

  useDidShow(() => setSnapshot(readCourseSnapshot()))
  useEffect(() => subscribeToContentUpdates(() => {
    setSnapshot(readCourseSnapshot())
  }), [])

  const openItem = async (item: CourseItem) => {
    if (!item.session || !item.progress) return
    if (item.status === 'locked' || item.status === 'unavailable') return

    const nextProgress = transitionTraining(
      item.progress,
      item.session,
      { type: 'START' },
    )
    trackTrainingStart(item.session, nextProgress, 'course')
    writeTrainingProgress(nextProgress)
    await Taro.navigateTo({ url: trainingUrl(item.sessionId) })
  }

  const restartItem = async (item: CourseItem) => {
    if (!item.session || !item.progress) return

    const result = await Taro.showModal({
      title: '重新训练？',
      content: `“${item.session.title}”的当前完成记录会被清除。其他训练不受影响。`,
      confirmText: '重新开始',
      confirmColor: '#5b5bd6',
    })
    if (!result.confirm) return

    clearTrainingProgress(item.session)
    const reset = transitionTraining(item.progress, item.session, { type: 'RESET' })
    const started = transitionTraining(reset, item.session, { type: 'START' })
    trackTrainingStart(item.session, started, 'restart')
    writeTrainingProgress(started)
    setSnapshot(readCourseSnapshot())
    await Taro.navigateTo({ url: `/pages/training/index?sessionId=${item.sessionId}&entry=restart` })
  }

  const library = trainingContent.library
  if (!library) {
    return (
      <View className='course-page course-page--centered'>
        <View className='course-error'>
          <Text className='course-error__title'>课程内容暂时不可用</Text>
          <Text className='course-error__body'>课程库没有通过校验，请稍后再试。</Text>
          <Button
            className='microly-button course-secondary-button'
            onClick={() => Taro.switchTab({ url: '/pages/index/index' })}
          >
            返回今日
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
    preference,
  } = snapshot

  return (
    <View className='course-page'>
      <View className='course-hero'>
        <Text className='course-hero__eyebrow'>微习 · 本地课程</Text>
        <Text className='course-hero__title'>{library.title}</Text>
        <Text className='course-hero__description'>{library.description}</Text>
        <View className='course-progress'>
          <Text className='course-progress__value'>
            {overview.completedCount}/{overview.availableCount}
          </Text>
          <Text className='course-progress__label'>组训练已完成</Text>
        </View>
      </View>

      {recoveredSessionIds.length > 0 && (
        <View className='course-notice'>部分本地进度损坏，已安全重置。</View>
      )}
      {reviewWarning && (
        <View className='course-notice'>部分复习数据无法读取，已安全整理。</View>
      )}
      {(preference.recoveredFromInvalid || preference.writeFailed) && (
        <View className='course-notice'>部分学习偏好无法读取，已安全整理。</View>
      )}

      <View className='course-list'>
        {overview.chapters.map((chapter, chapterIndex) => (
          <View
            key={chapter.catalogId}
            className={`course-chapter course-chapter--${chapter.status.replace('_', '-')}`}
          >
            <View className='course-chapter__topline'>
              <Text className='course-chapter__eyebrow'>第 {chapterIndex + 1} 章</Text>
              <View className='course-chapter__meta'>
                {preference.selectedCatalogIds.includes(chapter.catalogId) && (
                  <Text className='course-chapter__preference'>你的重点</Text>
                )}
                <Text className='course-chapter__status'>
                  {chapterStatusLabels[chapter.status]}
                </Text>
              </View>
            </View>
            <Text className='course-chapter__title'>
              {chapter.catalog?.title ?? `章节 ${chapterIndex + 1}`}
            </Text>
            <Text className='course-chapter__description'>
              {chapter.catalog?.description ?? chapter.error ?? '章节内容暂不可用'}
            </Text>
            <Text className='course-chapter__progress'>
              {chapter.completedCount}/{chapter.availableCount} 组完成
            </Text>

            {chapter.items.length > 0 && (
              <View className='course-chapter__items'>
                {chapter.items.map((item, itemIndex) => {
                  const statusClass = item.status.replace('_', '-')
                  const title = item.session?.title ?? `第 ${itemIndex + 1} 组训练`
                  const objective = item.session?.objective ?? item.error ?? '内容暂不可用'
                  const dueReview = reviewOverview.dueItems.find(
                    (entry) => entry.item.sessionId === item.sessionId,
                  )
                  const upcomingReview = reviewOverview.upcomingItems.find(
                    (entry) => entry.item.sessionId === item.sessionId,
                  )

                  return (
                    <View
                      key={item.sessionId}
                      className={`course-item course-item--${statusClass}`}
                    >
                      <View className='course-item__number'>{itemIndex + 1}</View>
                      <View className='course-item__content'>
                        <View className='course-item__topline'>
                          <Text className='course-item__status'>{statusLabels[item.status]}</Text>
                          {item.session && (
                            <Text className='course-item__duration'>
                              约 {item.session.estimatedMinutes} 分钟
                            </Text>
                          )}
                        </View>
                        <Text className='course-item__title'>{title}</Text>
                        <Text className='course-item__objective'>{objective}</Text>
                        {(dueReview || upcomingReview) && (
                          <View className={`course-review-badge ${dueReview ? 'course-review-badge--due' : ''}`}>
                            {dueReview
                              ? '待复习'
                              : `${formatReviewDate(upcomingReview?.item.dueAt as string)}复习`}
                          </View>
                        )}

                        {(item.status === 'not_started' || item.status === 'in_progress') && (
                          <Button
                            className='microly-button course-primary-button'
                            onClick={() => openItem(item)}
                          >
                            {item.status === 'in_progress' ? '继续练习' : '开始训练'}
                          </Button>
                        )}

                        {item.status === 'completed' && (
                          <View className='course-item__actions'>
                            <Button
                              className='microly-button course-primary-button'
                              onClick={() => openItem(item)}
                            >
                              查看总结
                            </Button>
                            <Button
                              className='microly-button course-text-button'
                              onClick={() => restartItem(item)}
                            >
                              重新训练
                            </Button>
                          </View>
                        )}
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  )
}
