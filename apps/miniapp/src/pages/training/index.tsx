import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

import {
  firstTrainingResult,
  firstTrainingSession,
} from '../../data/first-training'
import TrainingCardRenderer from '../../features/training/TrainingCardRenderer'
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
  const [progress, setProgress] = useState<TrainingProgress | null>(() =>
    firstTrainingSession
      ? readTrainingProgress(firstTrainingSession).progress
      : null,
  )
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)

  useEffect(() => {
    if (!firstTrainingSession) {
      return
    }

    const stored = readTrainingProgress(firstTrainingSession)
    setRecoveredFromInvalid(stored.recoveredFromInvalid)

    const nextProgress = stored.progress.status === 'not_started'
      ? transitionTraining(
          stored.progress,
          firstTrainingSession,
          { type: 'START' },
        )
      : stored.progress

    setProgress(nextProgress)
    if (!writeTrainingProgress(nextProgress)) {
      setStorageWarning(true)
    }
  }, [])

  const applyAction = (action: TrainingAction) => {
    if (!firstTrainingSession) {
      return
    }

    const session = firstTrainingSession

    setProgress((current) => {
      if (!current) {
        return current
      }

      const nextProgress = transitionTraining(
        current,
        session,
        action,
      )
      if (nextProgress !== current && !writeTrainingProgress(nextProgress)) {
        setStorageWarning(true)
      }
      return nextProgress
    })
  }

  const backHome = async () => {
    try {
      await Taro.navigateBack()
    } catch {
      await Taro.reLaunch({ url: '/pages/index/index' })
    }
  }

  if (!firstTrainingSession || !firstTrainingResult.success || !progress) {
    return (
      <View className='training-page training-page--centered'>
        <View className='training-error'>
          <Text className='card-eyebrow'>内容暂时不可用</Text>
          <Text className='card-title'>训练内容没有通过校验</Text>
          <Text className='training-error__body'>我们没有加载未经验证的内容。</Text>
          <Button className='training-primary-button' onClick={backHome}>
            返回首页
          </Button>
        </View>
      </View>
    )
  }

  const progressPercent =
    ((progress.currentCardIndex + 1) / firstTrainingSession.cards.length) * 100

  return (
    <View className='training-page'>
      <View className='training-toolbar'>
        <Button className='exit-button' onClick={backHome}>退出</Button>
        <Text className='training-toolbar__step'>
          {progress.currentCardIndex + 1} / {firstTrainingSession.cards.length}
        </Text>
      </View>
      <View className='progress-track'>
        <View
          className='progress-track__value'
          style={{ width: `${progressPercent}%` }}
        />
      </View>

      {(recoveredFromInvalid || storageWarning) && (
        <View className='training-notice'>
          {storageWarning
            ? '当前进度暂时无法保存，请保持页面开启。'
            : '旧的本地进度无法读取，已从头开始。'}
        </View>
      )}

      <TrainingCardRenderer
        session={firstTrainingSession}
        progress={progress}
        onAction={applyAction}
        onBackHome={backHome}
      />
    </View>
  )
}
