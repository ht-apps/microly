import { describe, expect, it } from 'vitest'

import { firstTrainingSession } from '../../data/first-training'
import { evaluatePractice } from './practice-evaluation'
import { getPracticeCard } from './training-state'

if (!firstTrainingSession) {
  throw new Error('测试训练内容应当通过 Schema 校验')
}

const practiceCard = getPracticeCard(firstTrainingSession)

describe('evaluatePractice', () => {
  it('识别三个表达维度', () => {
    const result = evaluatePractice(
      '我今天时间上无法完成全部内容，可以先做最关键的部分，其余明早补齐。',
      practiceCard,
    )

    expect(result.map((item) => item.status)).toEqual([
      'detected',
      'detected',
      'detected',
    ])
  })

  it('对部分命中的表达给出部分提示', () => {
    const result = evaluatePractice(
      '我今天无法完成全部分析，需要再讨论一下。',
      practiceCard,
    )

    expect(result.map((item) => item.status)).toEqual([
      'detected',
      'missing',
      'missing',
    ])
  })

  it('忽略空白并保留匹配到的关键词', () => {
    const result = evaluatePractice(
      '我时间上无法完成全部内容，但可 以 先 完 成关键部分，明天补齐。',
      practiceCard,
    )

    expect(result.every((item) => item.status === 'detected')).toBe(true)
    expect(result[2]?.matchedKeywords).toContain('明天')
  })
})
