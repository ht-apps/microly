import { trainingContentBundle } from '@microly/training-content'
import { describe, expect, it } from 'vitest'

import { normalizeContentBundle, validateContentBundle } from './admin.js'

describe('admin content policy', () => {
  it('拒绝孤立内容和高风险训练', () => {
    const bundle = structuredClone(trainingContentBundle)
    bundle.sessions['orphan-session'] = { ...bundle.sessions['boundary-decline-001']!, sessionId: 'orphan-session', riskLevel: 'high' }
    const result = validateContentBundle(bundle)
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.path === 'sessions.orphan-session')).toBe(true)
    expect(result.issues.some((issue) => issue.path === 'sessions.orphan-session.riskLevel')).toBe(true)
  })

  it('只为变化实体递增内容版本', () => {
    const next = structuredClone(trainingContentBundle)
    next.sessions['boundary-decline-001']!.title = '新的训练标题'
    const normalized = normalizeContentBundle(next, [trainingContentBundle], 2)
    expect(normalized.releaseVersion).toBe(2)
    expect(normalized.sessions['boundary-decline-001']!.contentVersion).toBe(2)
    expect(normalized.sessions['boundary-priority-002']!.contentVersion).toBe(1)
  })
})
