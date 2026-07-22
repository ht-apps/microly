import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter } from '@tarojs/taro'

import {
  getFirstAvailableTraining,
  getTrainingEntry,
  getTrainingSession,
} from '../../data/training-content'
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

  useEffect(() => {
    if (!session) {
      return
    }

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
    if (!writeTrainingProgress(nextProgress)) {
      setStorageWarning(true)
    }
  }, [session])

  const applyAction = (action: TrainingAction) => {
    if (!session) {
      return
    }

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
          <Button className='training-primary-button' onClick={backHome}>
            返回首页
          </Button>
        </View>
      </View>
    )
  }

  const progressPercent =
    ((progress.currentCardIndex + 1) / session.cards.length) * 100

  return (
    <View className='training-page'>
      <View className='training-toolbar'>
        <Button className='exit-button' onClick={backHome}>退出</Button>
        <Text className='training-toolbar__step'>
          {progress.currentCardIndex + 1} / {session.cards.length}
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
        session={session}
        progress={progress}
        onAction={applyAction}
        onBackHome={backHome}
      />
    </View>
  )
}
