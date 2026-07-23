import { Empty } from 'antd'
import type { TrainingOptionRating, TrainingSession } from '@microly/content-schema'

const cardMeta = {
  scenario: { label: '情境', hint: 'SCENARIO' },
  choice: { label: '选择', hint: 'CHOICE' },
  feedback: { label: '反馈', hint: 'FEEDBACK' },
  principle: { label: '原则', hint: 'PRINCIPLE' },
  practice: { label: '练习', hint: 'PRACTICE' },
  completion: { label: '完成', hint: 'COMPLETE' },
} as const

const optionLabels: Record<TrainingOptionRating, string> = {
  recommended: '推荐',
  risky: '有风险',
  not_recommended: '不推荐',
}

export function CardPreview({ session }: { session: TrainingSession | null }) {
  if (!session) return <Empty className="preview-empty" description="选择一组训练后预览卡片" />
  return <div className="phone-preview">
    <div className="phone-preview__chrome" aria-hidden="true">
      <span>9:41</span><i /><div><b /><b /><b /></div>
    </div>
    <div className="phone-preview__nav"><span>训练预览</span><i>•••</i></div>
    <header className="phone-preview__header">
      <div className="preview-pills">
        <span>{session.skill}</span>
        <span>{session.difficulty}</span>
      </div>
      <h3>{session.title}</h3>
      <p>{session.objective}</p>
      <div className="preview-session-meta">
        <span>{session.estimatedMinutes} 分钟</span>
        <span>{session.cards.length} 张卡片</span>
        <span>{session.riskLevel === 'low' ? '低风险' : session.riskLevel === 'medium' ? '中风险' : '高风险'}</span>
      </div>
    </header>
    <div className="preview-card-list">
      {session.cards.map((card, index) => {
        const meta = cardMeta[card.type]
        return <article className={`preview-card preview-card--${card.type}`} key={card.id}>
          <div className="preview-card__topline">
            <span className="preview-card__step">{String(index + 1).padStart(2, '0')}</span>
            <span className="preview-card__type">{meta.hint}</span>
            <span className="preview-card__label">{meta.label}</span>
          </div>
          {card.type === 'scenario' && <>
            <p className="preview-card__eyebrow">{card.eyebrow}</p>
            <h4>{card.title}</h4>
            <div className="preview-context">{card.context}</div>
            <div className="preview-question"><span>想一想</span>{card.question}</div>
          </>}
          {card.type === 'choice' && <>
            <h4>{card.prompt}</h4>
            <div className="preview-options">{card.options.map((option, optionIndex) => <div className={`preview-option ${option.rating}`} key={option.id}>
              <span className="preview-option__index">{String.fromCharCode(65 + optionIndex)}</span>
              <p>{option.text}</p>
              <small>{optionLabels[option.rating]}</small>
            </div>)}</div>
          </>}
          {card.type === 'feedback' && <>
            <h4>{card.title}</h4>
            <p>{card.comparisonLabel}</p>
            <div className="preview-comparison"><span>表达方式</span><i /><span>沟通结果</span></div>
          </>}
          {card.type === 'principle' && <>
            <h4>{card.title}</h4>
            <p>{card.summary}</p>
            <div className="preview-formula">{card.formula}</div>
            <div className="preview-example"><span>参考表达</span>{card.example}</div>
          </>}
          {card.type === 'practice' && <>
            <h4>{card.title}</h4>
            <p>{card.prompt}</p>
            <div className="preview-dimensions">{card.dimensions.map((dimension) => <span key={dimension.id}>{dimension.title}</span>)}</div>
            <div className="preview-input"><span>在这里组织你的表达…</span><small>0 / {card.maxLength}</small></div>
          </>}
          {card.type === 'completion' && <>
            <div className="preview-complete-icon">✓</div>
            <h4>{card.title}</h4>
            <p>{card.summary}</p>
            <div className="preview-takeaway"><span>本次带走</span>{card.takeaway}</div>
          </>}
        </article>
      })}
    </div>
  </div>
}
