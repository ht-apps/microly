import { describe, expect, it } from 'vitest'

import { trainingContent } from '../../data/training-content'
import {
  addFavorite,
  createFavoriteId,
  findPrincipleCard,
  parseFavoriteQueue,
  removeFavorite,
} from './favorite-state'

const firstSession = trainingContent.sessions[0]
const secondSession = trainingContent.sessions[1]
if (!firstSession || !secondSession) throw new Error('缺少收藏测试内容')

describe('favorite state', () => {
  it('创建收藏、阻止重复并支持取消', () => {
    const created = addFavorite([], firstSession, '2026-07-20T08:00:00.000Z')
    expect(created.changed).toBe(true)
    expect(created.item?.favoriteId).toBe(`${firstSession.sessionId}:principle`)

    const repeated = addFavorite(created.items, firstSession)
    expect(repeated.changed).toBe(false)
    expect(repeated.items).toHaveLength(1)

    const removed = removeFavorite(created.items, created.item?.favoriteId ?? '')
    expect(removed.changed).toBe(true)
    expect(removed.items).toEqual([])
  })

  it('按收藏时间倒序解析', () => {
    const first = addFavorite([], firstSession, '2026-07-20T08:00:00.000Z')
    const second = addFavorite(first.items, secondSession, '2026-07-21T08:00:00.000Z')
    const parsed = parseFavoriteQueue(second.items.reverse(), trainingContent.sessions)

    expect(parsed.resolvedItems.map((entry) => entry.session.sessionId)).toEqual([
      secondSession.sessionId,
      firstSession.sessionId,
    ])
  })

  it('逐项过滤损坏、重复和未知内容', () => {
    const valid = addFavorite([], firstSession, '2026-07-20T08:00:00.000Z').item
    const parsed = parseFavoriteQueue([
      valid,
      valid,
      { ...valid, favoriteId: 'unknown:principle', sessionId: 'unknown' },
      { broken: true },
    ], trainingContent.sessions)

    expect(parsed.items).toHaveLength(1)
    expect(parsed.recoveredFromInvalid).toBe(true)
  })

  it('内容版本变化时保留收藏并标记已更新', () => {
    const principleCard = findPrincipleCard(firstSession)
    if (!principleCard) throw new Error('缺少原则卡')
    const parsed = parseFavoriteQueue([{
      favoriteId: createFavoriteId(firstSession.sessionId, principleCard.id),
      sessionId: firstSession.sessionId,
      contentVersion: firstSession.contentVersion + 1,
      cardId: principleCard.id,
      createdAt: '2026-07-20T08:00:00.000Z',
    }], trainingContent.sessions)

    expect(parsed.items).toHaveLength(1)
    expect(parsed.resolvedItems[0]?.contentUpdated).toBe(true)
    expect(parsed.recoveredFromInvalid).toBe(false)
  })
})
