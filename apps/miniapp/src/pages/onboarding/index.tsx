import { useEffect, useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'

import {
  getFirstAvailableTraining,
  trainingContent,
} from '../../data/training-content'
import { trackEvent } from '../../features/analytics/analytics-client'
import { readLearningActivity } from '../../features/activity/activity-storage'
import { toggleCatalogPreference } from '../../features/preference/preference-state'
import {
  resolveStoredOnboarding,
  saveUserPreference,
} from '../../features/preference/preference-storage'
import { transitionTraining } from '../../features/training/training-state'
import {
  readAllTrainingProgress,
  readTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

type OnboardingStep = 'intro' | 'preference'

const catalogs = trainingContent.chapters.flatMap(
  (chapter) => chapter.catalog ? [chapter.catalog] : [],
)
const catalogIds = catalogs.map((catalog) => catalog.catalogId)

export default function OnboardingPage() {
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState<OnboardingStep>('intro')
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<string[]>([])
  const [recoveredFromInvalid, setRecoveredFromInvalid] = useState(false)

  useEffect(() => {
    trackEvent('onboarding_view', { isFirstVisit: true })
    const training = readAllTrainingProgress(trainingContent.sessions)
    const activity = readLearningActivity(trainingContent.sessions)
    const hasExistingLearningData = Object.values(
      training.progressBySessionId,
    ).some((progress) => progress.status !== 'not_started')
      || activity.events.length > 0
    const launch = resolveStoredOnboarding(
      catalogIds,
      hasExistingLearningData,
    )

    if (launch.decision.action === 'open_today') {
      if (launch.writeFailed) {
        Taro.showToast({
          title: '偏好记录暂未保存，可稍后设置',
          icon: 'none',
        })
      }
      Taro.switchTab({ url: '/pages/index/index' })
      return
    }

    setRecoveredFromInvalid(launch.recoveredFromInvalid)
    setChecking(false)
  }, [])

  const togglePreference = (catalogId: string) => {
    const result = toggleCatalogPreference(selectedCatalogIds, catalogId)
    if (result.limitReached) {
      Taro.showToast({ title: '最多选择 2 项重点能力', icon: 'none' })
      return
    }
    setSelectedCatalogIds(result.selectedCatalogIds)
  }

  const startFirstTraining = async (preferenceIds: string[]) => {
    trackEvent('preference_submit', {
      selectedSkills: preferenceIds,
      skipped: preferenceIds.length === 0,
    })
    const saved = saveUserPreference(preferenceIds)
    if (saved.writeFailed) {
      Taro.showToast({
        title: '偏好暂未保存，可稍后重新设置',
        icon: 'none',
      })
    }

    const session = getFirstAvailableTraining()
    if (!session) {
      await Taro.switchTab({ url: '/pages/index/index' })
      return
    }
    const stored = readTrainingProgress(session)
    if (stored.progress.status === 'not_started') {
      trackEvent('training_start', {
        sessionId: session.sessionId,
        contentVersion: session.contentVersion,
        entry: 'onboarding',
      })
    }
    const started = transitionTraining(
      stored.progress,
      session,
      { type: 'START' },
    )
    if (!writeTrainingProgress(started)) {
      Taro.showToast({ title: '进度暂未保存，请保持页面开启', icon: 'none' })
    }
    await Taro.redirectTo({
      url: `/pages/training/index?sessionId=${session.sessionId}&entry=onboarding`,
    })
  }

  if (checking) {
    return (
      <View className='onboarding-page onboarding-page--centered'>
        <Text className='onboarding-loading'>正在准备今天的 3 分钟…</Text>
      </View>
    )
  }

  if (step === 'intro') {
    const firstSession = getFirstAvailableTraining()
    const scenario = firstSession?.cards.find((card) => card.type === 'scenario')

    return (
      <View className='onboarding-page'>
        <View className='onboarding-brand'>微习 MICROLY</View>
        <Text className='onboarding-title'>每天 3 分钟，练会一个小技能</Text>
        <Text className='onboarding-body'>
          用真实情景做判断、看反馈，再亲自练一句，把知道变成会用。
        </Text>

        {recoveredFromInvalid && (
          <View className='onboarding-notice'>旧的偏好记录无法读取，可以重新选择。</View>
        )}

        <View className='onboarding-example'>
          <Text className='onboarding-example__label'>一个真实情景</Text>
          <Text className='onboarding-example__title'>
            {scenario?.title ?? '临时任务打乱了原有安排'}
          </Text>
          <Text className='onboarding-example__body'>
            {scenario?.question ?? '怎样说明边界，同时推动事情继续向前？'}
          </Text>
          <View className='onboarding-example__formula'>情景判断 → 即时反馈 → 主动表达</View>
        </View>

        <Button
          className='microly-button onboarding-primary-button'
          onClick={() => setStep('preference')}
        >
          开始了解
        </Button>
        <Text className='onboarding-footnote'>无需登录，联网时会安全同步训练完成记录</Text>
      </View>
    )
  }

  return (
    <View className='onboarding-page'>
      <Button
        className='microly-button onboarding-back-button'
        onClick={() => setStep('intro')}
      >
        ‹ 上一步
      </Button>
      <Text className='onboarding-eyebrow'>选择学习重点</Text>
      <Text className='onboarding-title onboarding-title--preference'>
        你最想先提升什么？
      </Text>
      <Text className='onboarding-body'>
        可选择 1～2 项。课程仍从边界沟通基础开始，所选能力会标记为你的重点章节。
      </Text>

      <View className='onboarding-options'>
        {catalogs.map((catalog) => {
          const isSelected = selectedCatalogIds.includes(catalog.catalogId)
          return (
            <Button
              key={catalog.catalogId}
              className={`microly-button onboarding-option ${isSelected ? 'onboarding-option--selected' : ''}`}
              onClick={() => togglePreference(catalog.catalogId)}
            >
              <View className='onboarding-option__check'>{isSelected ? '✓' : ''}</View>
              <View className='onboarding-option__content'>
                <Text className='onboarding-option__title'>{catalog.title}</Text>
                <Text className='onboarding-option__body'>{catalog.description}</Text>
              </View>
            </Button>
          )
        })}
      </View>

      <Button
        className='microly-button onboarding-primary-button'
        onClick={() => startFirstTraining(selectedCatalogIds)}
      >
        {selectedCatalogIds.length > 0 ? '开始 3 分钟训练' : '暂时跳过并开始'}
      </Button>
    </View>
  )
}
