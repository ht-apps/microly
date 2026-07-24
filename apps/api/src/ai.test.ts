import { trainingContentBundle } from '@microly/training-content'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDeepseekProvider, type AiModelRuntimeConfig } from './ai.js'

const config: AiModelRuntimeConfig = {
  modelId: 'deepseek-v4-flash', revision: 1, thinkingEnabled: false,
  maxTokens: 1200, temperature: 0.2, timeoutMs: 30000, dailyQuota: 5,
  inputCacheHitPrice: 0, inputCacheMissPrice: 0, outputPrice: 0,
}

describe('DeepSeek review variant generation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('feeds safe schema issues back into the single correction retry', async () => {
    const session = trainingContentBundle.sessions['report-risk-005']
    if (!session) throw new Error('missing session')
    const choice = session.cards.find((card) => card.type === 'choice')
    if (!choice) throw new Error('missing choice')
    const candidate = {
      variantId: 'generated-review-1', title: '风险同步复习',
      context: '项目交付依赖外部团队的数据，但对方通知可能无法按原计划提供，当前交付时间和影响范围都需要重新确认。',
      question: '你会如何向负责人同步？', prompt: '选择一句更合适的表达',
      options: choice.options.map((option, index) => ({ ...option, id: `generated-option-${index + 1}` })),
    }
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      const value = requests.length === 1 ? { ...candidate, context: '太短' } : candidate
      return new Response(JSON.stringify({
        model: config.modelId,
        choices: [{ message: { content: JSON.stringify({ candidates: [value] }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const result = await createDeepseekProvider('test-key').generateReviewVariants?.({
      session, count: 1, config, signal: new AbortController().signal,
    })

    expect(result?.formatRetries).toBe(1)
    expect(requests).toHaveLength(2)
    const messages = requests[1]!.messages as Array<{ content: string }>
    expect(messages[1]!.content).toContain('candidates.0.context')
  })
})
