import { useState } from 'react'
import { Button, Text, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'

import {
  getTrainingChapter,
  getTrainingSession,
  trainingContent,
} from '../../data/training-content'
import { readLearningActivity } from '../../features/activity/activity-storage'
import {
  createChallengeState,
  resolveChallengeContent,
  selectChallengeContinuation,
  transitionChallenge,
} from '../../features/challenge/challenge-state'
import {
  CHALLENGE_SHARE_IMAGE_URL,
  createChallengeSharePayload,
} from '../../features/challenge/challenge-share'
import { createCourseOverview } from '../../features/training/training-scheduler'
import { transitionTraining } from '../../features/training/training-state'
import {
  readAllTrainingProgress,
  readTrainingProgress,
  writeTrainingProgress,
} from '../../features/training/training-storage'

import './index.scss'

const ratingMeta = {
  recommended: { label: '更推荐', className: 'challenge-rating--recommended' },
  risky: { label: '可用但有风险', className: 'challenge-rating--risky' },
  not_recommended: { label: '不建议', className: 'challenge-rating--not-recommended' },
} as const

function readChallengeContinuation() {
  const training = readAllTrainingProgress(trainingContent.sessions)
  const activity = readLearningActivity(trainingContent.sessions)
  const hasExistingLearningData = Object.values(
    training.progressBySessionId,
  ).some((progress) => progress.status !== 'not_started')
    || activity.events.length > 0

  return selectChallengeContinuation(
    createCourseOverview(
      trainingContent.chapters,
      training.progressBySessionId,
    ),
    hasExistingLearningData,
  )
}

export default function ChallengePage() {
  const router = useRouter()
  const requestedSessionId = router.params.sessionId
  const session = requestedSessionId
    ? getTrainingSession(requestedSessionId)
    : null
  const content = session ? resolveChallengeContent(session) : null
  const chapter = session ? getTrainingChapter(session.sessionId) : null
  const [state, setState] = useState(createChallengeState)
  const [continuation] = useState(readChallengeContinuation)

  useShareAppMessage(() => (
    session
      ? createChallengeSharePayload(session)
      : {
          title: '一句话情景挑战｜微习 Microly',
          path: '/pages/onboarding/index',
          imageUrl: CHALLENGE_SHARE_IMAGE_URL,
        }
  ))

  const openMicroly = () => Taro.switchTab({ url: '/pages/index/index' })

  if (!session || !content) {
    return (
      <View className='challenge-page challenge-page--centered'>
        <View className='challenge-error'>
          <Text className='challenge-eyebrow'>挑战暂时不可用</Text>
          <Text className='challenge-title'>没有找到这道情景题</Text>
          <Text className='challenge-error__body'>
            分享内容可能已经更新或下架，可以进入微习查看当前课程。
          </Text>
          <Button className='microly-button challenge-primary-button' onClick={openMicroly}>
            打开微习
          </Button>
        </View>
      </View>
    )
  }

  const selectedOption = content.choiceCard.options.find(
    (option) => option.id === state.selectedOptionId,
  )
  const selectedRating = selectedOption ? ratingMeta[selectedOption.rating] : null

  const continueLearning = async () => {
    if (continuation.type === 'course') {
      await Taro.switchTab({ url: '/pages/course/index' })
      return
    }

    const targetSession = getTrainingSession(continuation.sessionId)
    if (!targetSession) {
      await openMicroly()
      return
    }
    const stored = readTrainingProgress(targetSession)
    const started = transitionTraining(
      stored.progress,
      targetSession,
      { type: 'START' },
    )
    if (!writeTrainingProgress(started)) {
      Taro.showToast({ title: '进度暂未保存，请保持页面开启', icon: 'none' })
    }
    await Taro.redirectTo({
      url: `/pages/training/index?sessionId=${targetSession.sessionId}`,
    })
  }

  return (
    <View className='challenge-page'>
      <View className='challenge-hero'>
        <Text className='challenge-brand'>微习 MICROLY</Text>
        <Text className='challenge-hero__label'>好友发来一道情景挑战</Text>
        <Text className='challenge-title'>{content.scenarioCard.title}</Text>
        <Text className='challenge-context'>{content.scenarioCard.context}</Text>
        <View className='challenge-question'>
          <Text>{content.scenarioCard.question}</Text>
        </View>
        <View className='challenge-tags'>
          <Text className='challenge-tag'>{chapter?.catalog?.title ?? session.skill}</Text>
          <Text className='challenge-tag'>约 30 秒</Text>
        </View>
      </View>

      <View className='challenge-card'>
        <Text className='challenge-eyebrow'>如果是你，会怎么说？</Text>
        <Text className='challenge-prompt'>{content.choiceCard.prompt}</Text>
        <View className='challenge-options'>
          {content.choiceCard.options.map((option, index) => {
            const isSelected = option.id === state.selectedOptionId
            return (
              <Button
                key={option.id}
                className={`microly-button challenge-option ${isSelected ? 'challenge-option--selected' : ''}`}
                aria-disabled={state.answerConfirmed}
                onClick={() => setState((current) => transitionChallenge(
                  current,
                  { type: 'SELECT', optionId: option.id },
                  content.choiceCard,
                ))}
              >
                <Text className='challenge-option__index'>
                  {String.fromCharCode(65 + index)}
                </Text>
                <Text className='challenge-option__text'>{option.text}</Text>
              </Button>
            )
          })}
        </View>

        {!state.answerConfirmed ? (
          <Button
            className='microly-button challenge-primary-button'
            disabled={!state.selectedOptionId}
            onClick={() => setState((current) => transitionChallenge(
              current,
              { type: 'CONFIRM' },
              content.choiceCard,
            ))}
          >
            确认回答
          </Button>
        ) : selectedOption && selectedRating ? (
          <>
            <View className='challenge-feedback'>
              <Text className={`challenge-rating ${selectedRating.className}`}>
                {selectedRating.label}
              </Text>
              <Text className='challenge-feedback__title'>对方可能这样理解</Text>
              <Text className='challenge-feedback__body'>
                {selectedOption.feedback.interpretation}
              </Text>
              <Text className='challenge-feedback__title'>需要留意</Text>
              <Text className='challenge-feedback__body'>
                {selectedOption.feedback.risk}
              </Text>
              {selectedOption.feedback.condition && (
                <>
                  <Text className='challenge-feedback__title'>更适合的条件</Text>
                  <Text className='challenge-feedback__body'>
                    {selectedOption.feedback.condition}
                  </Text>
                </>
              )}
              <View className='challenge-reference'>
                <Text className='challenge-reference__label'>更推荐的表达</Text>
                <Text className='challenge-reference__text'>
                  {content.recommendedOption.text}
                </Text>
              </View>
            </View>

            <Text className='challenge-privacy'>
              你的回答只在当前页面展示，不会写入训练、错题或学习记录。
            </Text>
            <Button className='microly-button challenge-primary-button' onClick={continueLearning}>
              {continuation.label}
            </Button>
            {process.env.TARO_ENV === 'weapp' ? (
              <Button
                className='microly-button challenge-share-button'
                openType='share'
              >
                再发给一位朋友
              </Button>
            ) : (
              <Button
                className='microly-button challenge-share-button'
                onClick={() => Taro.showToast({
                  title: '请在微信小程序中使用分享',
                  icon: 'none',
                })}
              >
                再发给一位朋友
              </Button>
            )}
          </>
        ) : null}
      </View>
    </View>
  )
}
