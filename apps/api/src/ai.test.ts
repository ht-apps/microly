import { remoteTrainingContentBundle, trainingContentBundle } from '@microly/training-content'
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
      const value = requests.length === 1 ? { ...candidate, question: '' } : candidate
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
    expect(messages[1]!.content).toContain('candidates.0.question')
  })

  it('regenerates a review variant that copies the original choice', async () => {
    const session = trainingContentBundle.sessions['report-risk-005']
    if (!session) throw new Error('missing session')
    const choice = session.cards.find((card) => card.type === 'choice')
    if (!choice) throw new Error('missing choice')
    const duplicate = {
      variantId: 'generated-review-copy', title: '风险同步复习',
      context: '项目依赖出现变化，当前交付时间可能受到影响，你需要向负责人同步已知事实、影响范围和下一步安排。',
      question: '你会如何向负责人同步？', prompt: choice.prompt,
      options: choice.options.map((option, index) => ({ ...option, id: `copy-option-${index + 1}` })),
    }
    const revised = {
      ...duplicate,
      prompt: '在新的协作情境中选择一句更合适的表达',
      options: duplicate.options.map((option, index) => ({ ...option, text: `${option.text} 新情境表达 ${index + 1}` })),
    }
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      const candidate = requests.length === 1 ? duplicate : revised
      return new Response(JSON.stringify({
        model: config.modelId,
        choices: [{ message: { content: JSON.stringify({ candidate }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const result = await createDeepseekProvider('test-key').generateReviewVariants?.({
      session, count: 1, config, signal: new AbortController().signal,
    })

    expect(result?.formatRetries).toBe(1)
    expect(requests).toHaveLength(2)
    const messages = requests[1]!.messages as Array<{ content: string }>
    expect(messages[1]!.content).toContain('不能与原题完全相同')
  })
})

describe('DeepSeek session outline generation', () => {
  afterEach(() => vi.unstubAllGlobals())

  const outline = {
    outlineId: 'model-business-id',
    title: '重新协商临时需求范围',
    objective: '练习说明当前容量并与对方确认本次请求的范围和优先级',
    difficulty: 'L3',
    riskLevel: 'low',
    scenarioAngle: '匿名协作方临时增加需求，需要在现有容量内重新确认交付范围。',
    reviewFocus: '范围、优先级和下一步确认',
  }

  it('assigns server UUIDs and enforces the requested difficulty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: config.modelId,
      choices: [{ message: { content: JSON.stringify({ outlines: [outline] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const result = await createDeepseekProvider('test-key').generateSessionOutlines?.({
      catalog: { catalogId: 'boundary-communication', title: '边界沟通', skill: 'boundary-communication', description: '边界沟通训练' },
      existingSessions: [], count: 1, difficulties: ['L1'], brief: '生成一个范围协商训练大纲', config,
      signal: new AbortController().signal,
    })
    const generated = (result?.value as { outlines: Array<typeof outline> }).outlines[0]!
    expect(generated.outlineId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    expect(generated.difficulty).toBe('L1')
  })

  it('feeds field paths into the schema correction retry', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      const value = requests.length === 1 ? { ...outline, scenarioAngle: '太短' } : outline
      return new Response(JSON.stringify({
        model: config.modelId,
        choices: [{ message: { content: JSON.stringify({ outlines: [value] }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const result = await createDeepseekProvider('test-key').generateSessionOutlines?.({
      catalog: { catalogId: 'boundary-communication', title: '边界沟通', skill: 'boundary-communication', description: '边界沟通训练' },
      existingSessions: [], count: 1, difficulties: ['L2'], brief: '生成一个范围协商训练大纲', config,
      signal: new AbortController().signal,
    })

    expect(result?.formatRetries).toBe(1)
    expect(requests).toHaveLength(2)
    const messages = requests[1]!.messages as Array<{ content: string }>
    expect(messages[1]!.content).toContain('outlines.0.scenarioAngle')
  })
})

describe('DeepSeek complete training generation', () => {
  afterEach(() => vi.unstubAllGlobals())

  const outline = {
    outlineId: 'd269b9c4-af25-4da3-859c-8f370fe36b22',
    title: '拒绝非职责范围内的协助请求',
    objective: '当同事提出额外协助请求时，能够说明当前职责边界并提供可行替代建议。',
    difficulty: 'L1' as const,
    riskLevel: 'low' as const,
    scenarioAngle: '匿名协作方临时提出职责范围外的请求，需要说明当前重点并确认替代方案。',
    reviewFocus: '边界、替代方案和下一步确认',
  }
  const catalog = { catalogId: 'boundary-communication', title: '边界沟通', skill: 'boundary-communication', description: '边界沟通训练' }

  function modelSession() {
    const session = structuredClone(remoteTrainingContentBundle.sessions['boundary-decline-001']!)
    session.sessionId = 'model-id'
    session.cards.forEach((card, index) => {
      card.id = `model-card-${index}`
      if (card.type === 'choice') card.options.forEach((option, optionIndex) => { option.id = `model-option-${optionIndex}` })
      if (card.type === 'practice') card.dimensions.forEach((dimension, dimensionIndex) => { dimension.id = `model-dimension-${dimensionIndex}` })
    })
    session.reviewVariants.forEach((variant, variantIndex) => {
      variant.variantId = `model-review-${variantIndex}`
      variant.options.forEach((option, optionIndex) => { option.id = `model-review-option-${variantIndex}-${optionIndex}` })
    })
    return session
  }

  function variantResponse(userContent: string) {
    const variantIndex = userContent.includes('"candidateNumber":2') ? 1 : 0
    return { output: { candidate: structuredClone(remoteTrainingContentBundle.sessions['boundary-decline-001']!.reviewVariants[variantIndex]!) } }
  }

  it('normalizes all generated identifiers and authoritative metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const userContent = request.messages[1]!.content
      const value = userContent.includes('"sourceSession"') ? variantResponse(userContent) : { session: modelSession() }
      return new Response(JSON.stringify({
        model: config.modelId,
        choices: [{ message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 100, completion_tokens: 900 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const result = await createDeepseekProvider('test-key').generateTrainingSessions?.({
      catalog, outlines: [outline], existingSessions: [], reviewVariantCount: 2, config,
      signal: new AbortController().signal,
    })
    const generated = (result?.value as { sessions: Array<ReturnType<typeof modelSession>> }).sessions[0]!
    expect(generated.sessionId).toMatch(/^generated-[0-9a-f-]{36}$/u)
    expect(generated.title).toBe(outline.title)
    expect(generated.cards.map((card) => card.id)).toEqual(['scenario', 'choice', 'feedback', 'principle', 'practice', 'completion'])
    expect(new Set(generated.reviewVariants.map((variant) => variant.variantId)).size).toBe(2)
    expect(generated.reviewVariants).toHaveLength(2)
  })

  it('feeds full-session schema paths into the correction retry', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push(request)
      const messages = request.messages as Array<{ content: string }>
      const userContent = messages[1]!.content
      if (userContent.includes('"sourceSession"')) {
        return new Response(JSON.stringify({
          model: config.modelId,
          choices: [{ message: { content: JSON.stringify(variantResponse(userContent)) } }],
          usage: { prompt_tokens: 50, completion_tokens: 300 },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const session = modelSession()
      const coreRequestCount = requests.filter((item) => {
        const itemMessages = item.messages as Array<{ content: string }>
        return !itemMessages[1]!.content.includes('"sourceSession"')
      }).length
      if (coreRequestCount === 1) {
        const practice = session.cards.find((card) => card.type === 'practice')!
        Reflect.deleteProperty(practice, 'disclaimer')
      }
      return new Response(JSON.stringify({
        model: config.modelId,
        choices: [{ message: { content: JSON.stringify({ session }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 900 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const result = await createDeepseekProvider('test-key').generateTrainingSessions?.({
      catalog, outlines: [outline], existingSessions: [], reviewVariantCount: 2, config,
      signal: new AbortController().signal,
    })

    expect(result?.formatRetries).toBe(1)
    expect(requests).toHaveLength(4)
    const messages = requests[1]!.messages as Array<{ content: string }>
    expect(messages[1]!.content).toContain('session.cards.4')
    expect(requests[0]!.max_tokens).toBe(4000)
  })
})
