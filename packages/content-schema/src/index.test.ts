import { describe, expect, it } from 'vitest'

import {
  TrainingCatalogSchema,
  TrainingContentBundleSchema,
  TrainingLibrarySchema,
  TrainingSessionSchema,
} from './index'
import { z } from 'zod'

describe('Zod runtime configuration', () => {
  it('使用兼容微信小程序沙箱的无 JIT 校验', () => {
    expect(z.config().jitless).toBe(true)
  })
})

const validSession = {
  schemaVersion: '1.0',
  sessionId: 'test-session',
  contentVersion: 1,
  title: '测试训练',
  objective: '完成一组可以观察和验证的表达训练目标',
  skill: 'test-skill',
  difficulty: 'L2',
  riskLevel: 'low',
  estimatedMinutes: 3,
  cards: [
    {
      id: 'scenario',
      type: 'scenario',
      eyebrow: '测试情景',
      title: '这是一个测试情景',
      context: '这是一个用于测试内容校验的完整情景描述，需要包含足够多的信息帮助用户理解当前的关系、目标和限制。',
      question: '你会如何回应？',
    },
    {
      id: 'choice',
      type: 'choice',
      prompt: '选择一句表达',
      options: [
        {
          id: 'option-a',
          text: '选项一',
          rating: 'risky',
          feedback: {
            interpretation: '对方可能有不同理解。',
            strength: '表达了部分信息。',
            risk: '缺少明确的下一步。',
          },
        },
        {
          id: 'option-b',
          text: '选项二',
          rating: 'not_recommended',
          feedback: {
            interpretation: '对方可能误解为承诺。',
            strength: '表达了配合意愿。',
            risk: '没有说明现实限制。',
          },
        },
        {
          id: 'option-c',
          text: '选项三',
          rating: 'recommended',
          feedback: {
            interpretation: '对方可以理解完整信息。',
            strength: '包含边界和下一步。',
            risk: '仍需根据紧急程度调整。',
          },
        },
      ],
    },
    {
      id: 'feedback',
      type: 'feedback',
      title: '查看反馈',
      comparisonLabel: '比较其他表达',
    },
    {
      id: 'principle',
      type: 'principle',
      title: '表达原则',
      summary: '这是一条可以迁移到其他相似场景中的表达原则。',
      formula: '事实 + 下一步',
      counterexample: '这是一个反例。',
      example: '这是一个更加完整和清晰的正向表达示例。',
    },
    {
      id: 'practice',
      type: 'practice',
      title: '主动练习',
      prompt: '请写一句回复。',
      minLength: 10,
      maxLength: 200,
      dimensions: [
        {
          id: 'next-step',
          title: '下一步',
          description: '提供一个能够执行的下一步。',
          keywords: ['明天'],
        },
      ],
      referenceAnswer: '这是一个经过审核的参考表达。',
      disclaimer: '这是本地结构提示，不是人工或 AI 评价。',
    },
    {
      id: 'completion',
      type: 'completion',
      title: '训练完成',
      summary: '你已经完成了本次训练。',
      takeaway: '带走一个可以继续使用的原则。',
    },
  ],
} as const

describe('TrainingSessionSchema', () => {
  it('接受合法的六卡训练内容', () => {
    expect(TrainingSessionSchema.safeParse(validSession).success).toBe(true)
  })

  it('拒绝重复的卡片 ID', () => {
    const session = structuredClone(validSession) as Record<string, any>
    session.cards[1].id = 'scenario'

    expect(TrainingSessionSchema.safeParse(session).success).toBe(false)
  })

  it('拒绝数量不足或评分非法的选项', () => {
    const session = structuredClone(validSession) as Record<string, any>
    session.cards[1].options.pop()
    session.cards[1].options[0].rating = 'perfect'

    expect(TrainingSessionSchema.safeParse(session).success).toBe(false)
  })

  it('拒绝错误的卡片顺序', () => {
    const session = structuredClone(validSession) as Record<string, any>
    const feedback = session.cards[2]
    session.cards[2] = session.cards[3]
    session.cards[3] = feedback

    expect(TrainingSessionSchema.safeParse(session).success).toBe(false)
  })

  it('拒绝最小字数大于最大字数的主动练习', () => {
    const session = structuredClone(validSession) as Record<string, any>
    session.cards[4].minLength = 201

    expect(TrainingSessionSchema.safeParse(session).success).toBe(false)
  })
})

describe('TrainingContentBundleSchema', () => {
  it('拒绝缺失章节或训练的发布包', () => {
    expect(TrainingContentBundleSchema.safeParse({
      releaseVersion: 1,
      library: {
        schemaVersion: '1.0',
        libraryId: 'test-library',
        contentVersion: 1,
        title: '测试课程',
        description: '用于验证完整课程发布包的测试数据。',
        catalogIds: ['missing-catalog'],
      },
      catalogs: {},
      sessions: {},
    }).success).toBe(false)
  })
})

describe('TrainingCatalogSchema', () => {
  const catalog = {
    schemaVersion: '1.0',
    catalogId: 'boundary-communication',
    contentVersion: 1,
    title: '边界沟通',
    skill: 'boundary-communication',
    description: '通过三个递进情景练习清晰地说明边界与下一步。',
    sessionIds: [
      'boundary-decline-001',
      'boundary-priority-002',
      'boundary-deadline-003',
    ],
  } as const

  it('接受合法的有序训练目录', () => {
    expect(TrainingCatalogSchema.safeParse(catalog).success).toBe(true)
  })

  it('拒绝重复或为空的训练 ID', () => {
    expect(TrainingCatalogSchema.safeParse({
      ...catalog,
      sessionIds: ['boundary-decline-001', 'boundary-decline-001'],
    }).success).toBe(false)
    expect(TrainingCatalogSchema.safeParse({
      ...catalog,
      sessionIds: [],
    }).success).toBe(false)
  })
})

describe('TrainingLibrarySchema', () => {
  const library = {
    schemaVersion: '1.0',
    libraryId: 'workplace-communication-foundations',
    contentVersion: 1,
    title: '职场沟通基础',
    description: '通过四个递进章节练习常见职场沟通能力。',
    catalogIds: [
      'boundary-communication',
      'clear-reporting',
      'constructive-disagreement',
      'action-alignment',
    ],
  } as const

  it('接受合法的有序课程库', () => {
    expect(TrainingLibrarySchema.safeParse(library).success).toBe(true)
  })

  it('拒绝重复或为空的目录 ID', () => {
    expect(TrainingLibrarySchema.safeParse({
      ...library,
      catalogIds: ['clear-reporting', 'clear-reporting'],
    }).success).toBe(false)
    expect(TrainingLibrarySchema.safeParse({
      ...library,
      catalogIds: [],
    }).success).toBe(false)
  })
})
