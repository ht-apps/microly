import { Button, Text, Textarea, View } from '@tarojs/components'
import type { AiEvaluation } from '@microly/api-contract'
import type {
  ChoiceCard,
  PracticeCard,
  TrainingOption,
  TrainingOptionRating,
  TrainingSession,
} from '@microly/content-schema'

import type {
  TrainingAction,
  TrainingProgress,
} from './training-state'
import type { AiAccessState } from '../ai/ai-access'
import { AI_FOREGROUND_WAIT_MS } from '../ai/ai-wait'

interface TrainingCardRendererProps {
  session: TrainingSession
  progress: TrainingProgress
  onAction: (action: TrainingAction) => void
  onBackHome: () => void
  onStartReview: () => void
  isPrincipleFavorite: boolean
  onToggleFavorite: () => void
  onShareUnavailable: () => void
  reviewDueAt?: string | null
  aiEvaluation?: AiEvaluation | null
  aiBusy?: boolean
  aiWaitSeconds?: number
  aiMessage?: string | null
  aiAccess?: AiAccessState
  onRequestAi?: () => void
  onLoginForAi?: () => void
  onRateAi?: (helpful: boolean) => void
}

const ratingMeta: Record<
  TrainingOptionRating,
  { label: string; className: string }
> = {
  recommended: {
    label: '更推荐',
    className: 'rating-badge--recommended',
  },
  risky: {
    label: '可用但有风险',
    className: 'rating-badge--risky',
  },
  not_recommended: {
    label: '不建议',
    className: 'rating-badge--not-recommended',
  },
}

function findChoiceCard(session: TrainingSession) {
  return session.cards.find((card): card is ChoiceCard => card.type === 'choice')
}

function FeedbackDetail({ option }: { option: TrainingOption }) {
  const meta = ratingMeta[option.rating]

  return (
    <View className='feedback-detail'>
      <View className='feedback-detail__header'>
        <Text className={`rating-badge ${meta.className}`}>{meta.label}</Text>
        <Text className='feedback-detail__answer'>{option.text}</Text>
      </View>
      <View className='feedback-row'>
        <Text className='feedback-row__label'>对方可能怎么理解</Text>
        <Text className='feedback-row__body'>{option.feedback.interpretation}</Text>
      </View>
      <View className='feedback-row'>
        <Text className='feedback-row__label'>这句话做到了</Text>
        <Text className='feedback-row__body'>{option.feedback.strength}</Text>
      </View>
      <View className='feedback-row'>
        <Text className='feedback-row__label'>需要留意</Text>
        <Text className='feedback-row__body'>{option.feedback.risk}</Text>
      </View>
      {option.feedback.condition && (
        <View className='feedback-row'>
          <Text className='feedback-row__label'>更适合的条件</Text>
          <Text className='feedback-row__body'>{option.feedback.condition}</Text>
        </View>
      )}
    </View>
  )
}

function PracticeEvaluation({
  card,
  progress,
}: {
  card: PracticeCard
  progress: TrainingProgress
}) {
  if (!progress.practiceEvaluation) {
    return null
  }

  return (
    <View className='practice-result'>
      <Text className='practice-result__title'>表达结构检查</Text>
      <View className='dimension-list'>
        {card.dimensions.map((dimension) => {
          const result = progress.practiceEvaluation?.find(
            (item) => item.dimensionId === dimension.id,
          )
          const isDetected = result?.status === 'detected'

          return (
            <View
              key={dimension.id}
              className={`dimension-item ${isDetected ? 'dimension-item--detected' : ''}`}
            >
              <Text className='dimension-item__icon'>{isDetected ? '✓' : '+'}</Text>
              <View className='dimension-item__content'>
                <Text className='dimension-item__title'>{dimension.title}</Text>
                <Text className='dimension-item__description'>
                  {isDetected ? '已检测到相关表达' : dimension.description}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
      <View className='reference-answer'>
        <Text className='reference-answer__label'>参考表达</Text>
        <Text className='reference-answer__text'>{card.referenceAnswer}</Text>
      </View>
      <Text className='practice-disclaimer'>{card.disclaimer}</Text>
    </View>
  )
}

function AiEvaluationView({ evaluation, card, waitSeconds = 0, onRate }: { evaluation: AiEvaluation; card: PracticeCard; waitSeconds?: number; onRate?: (helpful: boolean) => void }) {
  if (!evaluation.result) {
    const waitLimitSeconds = AI_FOREGROUND_WAIT_MS / 1000
    const elapsedSeconds = Math.max(0, waitLimitSeconds - waitSeconds)
    return <View className='ai-result ai-result--pending'>
      <Text className='ai-result__title'>AI 正在认真点评</Text>
      <Text className='ai-result__summary'>
        {waitSeconds > 0
          ? `已等待 ${elapsedSeconds} 秒，正在生成点评，请稍候。`
          : '可以继续完成训练，结果稍后会出现在复习页。'}
      </Text>
    </View>
  }
  const result = evaluation.result
  return <View className={`ai-result ai-result--${result.mode}`}>
    <Text className='ai-result__eyebrow'>{result.mode === 'ai' ? 'AI 表达点评' : '规则降级结果'}</Text>
    <Text className='ai-result__title'>{result.summary}</Text>
    <View className='ai-dimension-list'>
      {result.dimensions.map((dimension) => <View className={`ai-dimension ai-dimension--${dimension.level}`} key={dimension.dimensionId}>
        <Text className='ai-dimension__title'>{card.dimensions.find((item) => item.id === dimension.dimensionId)?.title ?? dimension.dimensionId}</Text>
        <Text className='ai-dimension__level'>{dimension.level === 'met' ? '已做到' : dimension.level === 'partial' ? '可加强' : '未体现'}</Text>
        <Text className='ai-dimension__reason'>{dimension.reason}</Text>
      </View>)}
    </View>
    {result.rewrite && <View className='reference-answer'>
      <Text className='reference-answer__label'>AI 参考改写</Text>
      <Text className='reference-answer__text'>{result.rewrite}</Text>
    </View>}
    {result.mode === 'ai' && <View className='ai-rating'>
      <Text className='ai-rating__label'>{evaluation.rating ? '感谢反馈' : '这条点评有帮助吗？'}</Text>
      {!evaluation.rating && <View className='ai-rating__actions'>
        <Button className='microly-button ai-rating__button' onClick={() => onRate?.(true)}>有帮助</Button>
        <Button className='microly-button ai-rating__button' onClick={() => onRate?.(false)}>没帮助</Button>
      </View>}
    </View>}
    <Text className='practice-disclaimer'>AI 内容仅供学习参考，不代表唯一正确表达。</Text>
  </View>
}

function PreviousButton({ onAction }: { onAction: (action: TrainingAction) => void }) {
  return (
    <Button
      className='microly-button training-previous-button'
      onClick={() => onAction({ type: 'PREVIOUS' })}
    >
      ‹ 上一步
    </Button>
  )
}

interface CompletedTrainingReviewProps {
  session: TrainingSession
  progress: TrainingProgress
  cardIndex: number
  onPrevious: () => void
  onNext: () => void
}

export function CompletedTrainingReview({
  session,
  progress,
  cardIndex,
  onPrevious,
  onNext,
}: CompletedTrainingReviewProps) {
  const card = session.cards[cardIndex]
  const choiceCard = findChoiceCard(session)
  const selectedOption = choiceCard?.options.find(
    (option) => option.id === progress.selectedOptionId,
  )

  if (!card || card.type === 'completion') return null

  let content
  switch (card.type) {
    case 'scenario':
      content = (
        <>
          <Text className='card-title'>{card.title}</Text>
          <Text className='scenario-context'>{card.context}</Text>
          <View className='scenario-question'><Text>{card.question}</Text></View>
        </>
      )
      break
    case 'choice':
      content = (
        <>
          <Text className='card-title'>{card.prompt}</Text>
          <View className='training-locked-notice'>选择已经确认，回看时不能修改。</View>
          <View className='option-list'>
            {card.options.map((option, index) => {
              const isSelected = option.id === progress.selectedOptionId
              return (
                <View
                  key={option.id}
                  className={`choice-option choice-option--locked ${isSelected ? 'choice-option--selected' : ''}`}
                >
                  <Text className='choice-option__index'>{String.fromCharCode(65 + index)}</Text>
                  <Text className='choice-option__text'>{option.text}</Text>
                </View>
              )
            })}
          </View>
        </>
      )
      break
    case 'feedback':
      content = (
        <>
          <Text className='card-title'>{card.title}</Text>
          {selectedOption && <FeedbackDetail option={selectedOption} />}
        </>
      )
      break
    case 'principle':
      content = (
        <>
          <Text className='card-title'>{card.title}</Text>
          <Text className='principle-summary'>{card.summary}</Text>
          <View className='formula-card'>
            <Text className='formula-card__label'>记住这个结构</Text>
            <Text className='formula-card__value'>{card.formula}</Text>
          </View>
          <View className='example-card example-card--negative'>
            <Text className='example-card__label'>容易造成误解</Text>
            <Text className='example-card__text'>{card.counterexample}</Text>
          </View>
          <View className='example-card example-card--positive'>
            <Text className='example-card__label'>更清晰的表达</Text>
            <Text className='example-card__text'>{card.example}</Text>
          </View>
        </>
      )
      break
    case 'practice':
      content = (
        <>
          <Text className='card-title'>{card.title}</Text>
          <Text className='practice-prompt'>{card.prompt}</Text>
          <View className='selected-summary'>
            <Text className='selected-summary__label'>你的表达</Text>
            <Text className='selected-summary__text'>{progress.practiceText}</Text>
          </View>
          <PracticeEvaluation card={card} progress={progress} />
        </>
      )
      break
    default:
      content = null
  }

  return (
    <View className='training-card training-review-card'>
      <Text className='card-eyebrow'>只读回看 · {cardIndex + 1}/5</Text>
      {content}
      <View className='training-review-actions'>
        {cardIndex > 0 && (
          <Button className='microly-button training-review-secondary' onClick={onPrevious}>
            ‹ 上一步
          </Button>
        )}
        <Button className='microly-button training-review-primary' onClick={onNext}>
          {cardIndex < 4 ? '下一步 ›' : '返回完成总结'}
        </Button>
      </View>
    </View>
  )
}

export default function TrainingCardRenderer({
  session,
  progress,
  onAction,
  onBackHome,
  onStartReview,
  isPrincipleFavorite,
  onToggleFavorite,
  onShareUnavailable,
  reviewDueAt,
  aiEvaluation,
  aiBusy,
  aiWaitSeconds = 0,
  aiMessage,
  aiAccess = 'unavailable',
  onRequestAi,
  onLoginForAi,
  onRateAi,
}: TrainingCardRendererProps) {
  const card = session.cards[progress.currentCardIndex]

  if (!card) {
    return null
  }

  switch (card.type) {
    case 'scenario':
      return (
        <View className='training-card scenario-card'>
          <Text className='card-eyebrow'>{card.eyebrow}</Text>
          <Text className='card-title'>{card.title}</Text>
          <Text className='scenario-context'>{card.context}</Text>
          <View className='scenario-question'>
            <Text>{card.question}</Text>
          </View>
          <Button
            className='microly-button training-primary-button'
            onClick={() => onAction({ type: 'NEXT' })}
          >
            开始判断
          </Button>
        </View>
      )

    case 'choice':
      return (
        <View className='training-card'>
          <Text className='card-eyebrow'>做出选择</Text>
          <Text className='card-title'>{card.prompt}</Text>
          {progress.choiceConfirmed && (
            <View className='training-locked-notice'>选择已经确认，返回仅用于回看。</View>
          )}
          <View className='option-list'>
            {card.options.map((option, index) => {
              const isSelected = progress.selectedOptionId === option.id
              const isLocked = progress.choiceConfirmed
              return (
                <Button
                  key={option.id}
                  className={`microly-button choice-option ${isSelected ? 'choice-option--selected' : ''} ${isLocked ? 'choice-option--locked' : ''}`}
                  aria-disabled={isLocked}
                  onClick={() => {
                    if (!isLocked) {
                      onAction({
                        type: 'SELECT_OPTION',
                        optionId: option.id,
                      })
                    }
                  }}
                >
                  <Text className='choice-option__index'>
                    {String.fromCharCode(65 + index)}
                  </Text>
                  <Text className='choice-option__text'>{option.text}</Text>
                </Button>
              )
            })}
          </View>
          {!progress.choiceConfirmed ? (
            <Button
              className='microly-button training-primary-button'
              disabled={!progress.selectedOptionId}
              onClick={() => onAction({ type: 'CONFIRM_CHOICE' })}
            >
              确认选择
            </Button>
          ) : (
            <Button
              className='microly-button training-primary-button'
              onClick={() => onAction({ type: 'NEXT' })}
            >
              查看反馈
            </Button>
          )}
          <PreviousButton onAction={onAction} />
        </View>
      )

    case 'feedback': {
      const choiceCard = findChoiceCard(session)
      const selectedOption = choiceCard?.options.find(
        (option) => option.id === progress.selectedOptionId,
      )
      const otherOptions = choiceCard?.options.filter(
        (option) => option.id !== progress.selectedOptionId,
      ) ?? []

      return (
        <View className='training-card'>
          <Text className='card-eyebrow'>即时反馈</Text>
          <Text className='card-title'>{card.title}</Text>
          {selectedOption && <FeedbackDetail option={selectedOption} />}
          <Button
            className='microly-button compare-button'
            onClick={() => onAction({ type: 'TOGGLE_OTHER_FEEDBACK' })}
          >
            {progress.otherFeedbackExpanded ? '收起其他表达' : card.comparisonLabel}
          </Button>
          {progress.otherFeedbackExpanded && (
            <View className='other-feedback-list'>
              {otherOptions.map((option) => (
                <FeedbackDetail key={option.id} option={option} />
              ))}
            </View>
          )}
          <Button
            className='microly-button training-primary-button'
            onClick={() => onAction({ type: 'NEXT' })}
          >
            提炼表达原则
          </Button>
          <PreviousButton onAction={onAction} />
        </View>
      )
    }

    case 'principle':
      return (
        <View className='training-card'>
          <Text className='card-eyebrow'>今天的表达原则</Text>
          <Text className='card-title'>{card.title}</Text>
          <Text className='principle-summary'>{card.summary}</Text>
          <View className='formula-card'>
            <Text className='formula-card__label'>记住这个结构</Text>
            <Text className='formula-card__value'>{card.formula}</Text>
          </View>
          <View className='example-card example-card--negative'>
            <Text className='example-card__label'>容易造成误解</Text>
            <Text className='example-card__text'>{card.counterexample}</Text>
          </View>
          <View className='example-card example-card--positive'>
            <Text className='example-card__label'>更清晰的表达</Text>
            <Text className='example-card__text'>{card.example}</Text>
          </View>
          <Button
            className={`microly-button favorite-button ${isPrincipleFavorite ? 'favorite-button--active' : ''}`}
            onClick={onToggleFavorite}
          >
            {isPrincipleFavorite ? '★ 已收藏原则' : '☆ 收藏这条原则'}
          </Button>
          <Button
            className='microly-button training-primary-button'
            onClick={() => onAction({ type: 'NEXT' })}
          >
            换你来回答
          </Button>
          <PreviousButton onAction={onAction} />
        </View>
      )

    case 'practice': {
      const textLength = progress.practiceText.trim().length
      const canSubmit = textLength >= card.minLength
      const aiReady = aiAccess === 'ready'
      const aiNeedsLogin = aiAccess === 'login_required'

      return (
        <View className='training-card'>
          <Text className='card-eyebrow'>主动表达</Text>
          <Text className='card-title'>{card.title}</Text>
          <Text className='practice-prompt'>{card.prompt}</Text>
          <View className='practice-input-wrap'>
            <Textarea
              className='practice-input'
              value={progress.practiceText}
              maxlength={card.maxLength}
              placeholder='写下你准备回复的一句话……'
              onInput={(event) => onAction({
                type: 'UPDATE_PRACTICE',
                text: event.detail.value,
              })}
            />
            <Text className='practice-counter'>
              {progress.practiceText.length} / {card.maxLength}
            </Text>
          </View>
          <Text className='practice-privacy-hint'>请勿填写真实姓名、联系方式、公司机密或其他敏感信息。点击 AI 点评后，原文会发送给 DeepSeek，但不会保存到云端。</Text>
          {!canSubmit && (
            <Text className='practice-hint'>至少输入 {card.minLength} 个字</Text>
          )}
          {!progress.practiceEvaluation && !progress.practiceSkipped ? (
            <>
              <Button
                className='microly-button training-primary-button'
                disabled={!canSubmit || aiBusy || aiAccess === 'unavailable'}
                onClick={aiReady ? onRequestAi : aiNeedsLogin ? onLoginForAi : undefined}
              >
                {aiBusy
                  ? '正在提交…'
                  : aiReady
                    ? '获取 AI 点评'
                    : aiNeedsLogin
                      ? '微信登录获取 AI 点评'
                      : 'AI 点评需联网使用'}
              </Button>
              {aiAccess === 'unavailable' && (
                <Text className='ai-inline-message'>当前构建未配置联网服务，可继续使用本地结构检查。</Text>
              )}
              <Button className='microly-button training-secondary-button' disabled={!canSubmit} onClick={() => onAction({ type: 'SUBMIT_PRACTICE' })}>本地结构检查</Button>
              <Button className='microly-button training-text-button' onClick={() => onAction({ type: 'SKIP_PRACTICE' })}>暂时跳过</Button>
              {aiMessage && <Text className='ai-inline-message'>{aiMessage}</Text>}
            </>
          ) : progress.practiceEvaluation ? (
            <>
              {aiEvaluation ? <AiEvaluationView evaluation={aiEvaluation} card={card} waitSeconds={aiWaitSeconds} onRate={onRateAi} /> : <PracticeEvaluation card={card} progress={progress} />}
              {aiMessage && <Text className='ai-inline-message'>{aiMessage}</Text>}
              <Button
                className='microly-button training-primary-button'
                disabled={aiWaitSeconds > 0}
                onClick={() => onAction({ type: 'COMPLETE' })}
              >
                {aiWaitSeconds > 0 ? '点评生成中，请稍候' : '完成今天的训练'}
              </Button>
            </>
          ) : null}
          {progress.practiceSkipped && <>
            <View className='training-locked-notice'>已跳过主动表达，不影响完成本次训练。</View>
            <Button className='microly-button training-primary-button' onClick={() => onAction({ type: 'COMPLETE' })}>完成今天的训练</Button>
          </>}
          <PreviousButton onAction={onAction} />
        </View>
      )
    }

    case 'completion': {
      const choiceCard = findChoiceCard(session)
      const selectedOption = choiceCard?.options.find(
        (option) => option.id === progress.selectedOptionId,
      )
      const detectedCount = progress.practiceEvaluation?.filter(
        (item) => item.status === 'detected',
      ).length ?? 0

      return (
        <View className='training-card completion-card'>
          <View className='completion-check'>✓</View>
          <Text className='card-title'>{card.title}</Text>
          <Text className='completion-summary'>{card.summary}</Text>
          <View className='completion-stats'>
            <View className='completion-stat'>
              <Text className='completion-stat__value'>1</Text>
              <Text className='completion-stat__label'>真实情景</Text>
            </View>
            <View className='completion-stat'>
              <Text className='completion-stat__value'>{detectedCount}/3</Text>
              <Text className='completion-stat__label'>结构提示</Text>
            </View>
          </View>
          {selectedOption && (
            <View className='selected-summary'>
              <Text className='selected-summary__label'>你的情景选择</Text>
              <Text className='selected-summary__text'>{selectedOption.text}</Text>
            </View>
          )}
          {aiEvaluation && <AiEvaluationView evaluation={aiEvaluation} card={session.cards.find((item): item is PracticeCard => item.type === 'practice')!} onRate={onRateAi} />}
          <View className='takeaway-card'>
            <Text className='takeaway-card__label'>带走这一句</Text>
            <Text className='takeaway-card__text'>{card.takeaway}</Text>
          </View>
          {reviewDueAt && (
            <View className='review-scheduled'>
              <Text className='review-scheduled__icon'>↻</Text>
              <View className='review-scheduled__content'>
                <Text className='review-scheduled__title'>已加入错题复习</Text>
                <Text className='review-scheduled__body'>
                  下一次复习已安排，回到今日页可以查看。
                </Text>
              </View>
            </View>
          )}
          <Button
            className={`microly-button favorite-button ${isPrincipleFavorite ? 'favorite-button--active' : ''}`}
            onClick={onToggleFavorite}
          >
            {isPrincipleFavorite ? '★ 已收藏原则' : '☆ 收藏本次原则'}
          </Button>
          <Button
            className='microly-button completion-review-button'
            onClick={onStartReview}
          >
            回看本次训练
          </Button>
          {process.env.TARO_ENV === 'weapp' ? (
            <Button
              className='microly-button completion-share-button'
              openType='share'
            >
              分享情景挑战
            </Button>
          ) : (
            <Button
              className='microly-button completion-share-button'
              onClick={onShareUnavailable}
            >
              分享情景挑战
            </Button>
          )}
          <Button className='microly-button training-primary-button' onClick={onBackHome}>
            回到今日
          </Button>
        </View>
      )
    }

    default:
      return null
  }
}
