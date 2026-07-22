import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'

import {
  firstTrainingResult,
  firstTrainingSession,
} from '../../data/first-training'
import {
  transitionTraining,
  type TrainingProgress,
} from '../../features/training/training-state'
import {
  clearTrainingProgress,
  readTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

export default function Index() {
  const [progress, setProgress] = useState<TrainingProgress | null>(() =>
    firstTrainingSession
      ? readTrainingProgress(firstTrainingSession).progress
      : null,
  )
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false)

  useDidShow(() => {
    if (!firstTrainingSession) {
      return
    }

    const stored = readTrainingProgress(firstTrainingSession)
    setProgress(stored.progress)
    setRecoveredFromInvalid(stored.recoveredFromInvalid)
  })

  const openTraining = async () => {
    if (!firstTrainingSession || !progress) {
      return
    }

    const nextProgress = transitionTraining(
      progress,
      firstTrainingSession,
      { type: 'START' },
    )
    writeTrainingProgress(nextProgress)
    setProgress(nextProgress)
    await Taro.navigateTo({ url: '/pages/training/index' })
  }

  const restartTraining = async () => {
    if (!firstTrainingSession || !progress) {
      return
    }

    const result = await Taro.showModal({
      title: '重新训练？',
      content: '当前完成记录会被清除，并从第一个情景重新开始。',
      confirmText: '重新开始',
      confirmColor: '#5b5bd6',
    })

    if (!result.confirm) {
      return
    }

    clearTrainingProgress()
    const resetProgress = transitionTraining(
      progress,
      firstTrainingSession,
      { type: 'RESET' },
    )
    const startedProgress = transitionTraining(
      resetProgress,
      firstTrainingSession,
      { type: 'START' },
    )
    writeTrainingProgress(startedProgress)
    setProgress(startedProgress)
    await Taro.navigateTo({ url: '/pages/training/index' })
  }

  if (!firstTrainingSession || !firstTrainingResult.success || !progress) {
    return (
      <View className='home-page home-page--centered'>
        <View className='error-card'>
          <Text className='error-card__eyebrow'>内容暂时不可用</Text>
          <Text className='error-card__title'>这组训练没有通过内容校验</Text>
          <Text className='error-card__body'>请重新加载，或稍后再试。</Text>
          <Button
            className='secondary-button'
            onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}
          >
            重新加载
          </Button>
        </View>
      </View>
    )
  }

  const isCompleted = progress.status === 'completed'
  const isInProgress = progress.status === 'in_progress'

  return (
    <View className='home-page'>
      <View className='home-hero'>
        <Text className='brand-mark'>微习 MICROLY</Text>
        <Text className='home-hero__title'>今天，练一句更清晰的表达</Text>
        <Text className='home-hero__subtitle'>每天 3 分钟，把知道变成会用。</Text>
      </View>

      {recoveredFromInvalid && (
        <View className='notice-banner'>
          本地进度无法读取，已为你安全重置。
        </View>
      )}

      <View className={`today-card ${isCompleted ? 'today-card--completed' : ''}`}>
        <View className='today-card__topline'>
          <Text className='today-card__label'>今日 3 分钟</Text>
          <Text className='today-card__duration'>约 {firstTrainingSession.estimatedMinutes} 分钟</Text>
        </View>

        <Text className='today-card__title'>{firstTrainingSession.title}</Text>
        <Text className='today-card__objective'>{firstTrainingSession.objective}</Text>

        <View className='skill-row'>
          <Text className='skill-chip'>边界沟通</Text>
          <Text className='skill-chip'>真实情景</Text>
          <Text className='skill-chip'>主动练习</Text>
        </View>

        {isCompleted ? (
          <View className='completed-actions'>
            <View className='completion-note'>
              <Text className='completion-note__icon'>✓</Text>
              <View>
                <Text className='completion-note__title'>今天的训练已完成</Text>
                <Text className='completion-note__body'>事实 + 优先级 + 可兑现的下一步</Text>
              </View>
            </View>
            <Button className='primary-button' onClick={openTraining}>
              查看完成总结
            </Button>
            <Button className='text-button' onClick={restartTraining}>
              重新训练
            </Button>
          </View>
        ) : (
          <Button className='primary-button' onClick={openTraining}>
            {isInProgress
              ? `继续练习 · ${progress.currentCardIndex + 1}/${firstTrainingSession.cards.length}`
              : '开始今天的 3 分钟'}
          </Button>
        )}
      </View>

      <View className='week-card'>
        <View>
          <Text className='week-card__label'>本周进度</Text>
          <Text className='week-card__value'>{isCompleted ? '1' : '0'} / 3 天</Text>
        </View>
        <View className='week-dots'>
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <View
              key={day}
              className={`week-dot ${day === 0 && isCompleted ? 'week-dot--done' : ''}`}
            />
          ))}
        </View>
      </View>
    </View>
  )
}
