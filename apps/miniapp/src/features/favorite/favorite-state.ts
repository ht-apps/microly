import type { PrincipleCard, TrainingSession } from '@microly/content-schema'

export interface FavoriteItem {
  favoriteId: string
  sessionId: string
  contentVersion: number
  cardId: string
  createdAt: string
}

export interface ResolvedFavoriteItem {
  item: FavoriteItem
  session: TrainingSession
  principleCard: PrincipleCard
  contentUpdated: boolean
}

export interface ParsedFavoriteQueue {
  items: FavoriteItem[]
  resolvedItems: ResolvedFavoriteItem[]
  recoveredFromInvalid: boolean
}

export function createFavoriteId(sessionId: string, cardId: string) {
  return `${sessionId}:${cardId}`
}

export function findPrincipleCard(session: TrainingSession) {
  return session.cards.find(
    (card): card is PrincipleCard => card.type === 'principle',
  ) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isFavoriteItem(value: unknown): value is FavoriteItem {
  if (!isRecord(value)) return false

  return (
    typeof value.favoriteId === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.contentVersion === 'number'
    && Number.isInteger(value.contentVersion)
    && value.contentVersion > 0
    && typeof value.cardId === 'string'
    && isIsoTime(value.createdAt)
    && value.favoriteId === createFavoriteId(value.sessionId, value.cardId)
  )
}

export function parseFavoriteQueue(
  value: unknown,
  sessions: TrainingSession[],
): ParsedFavoriteQueue {
  if (value === undefined || value === '') {
    return { items: [], resolvedItems: [], recoveredFromInvalid: false }
  }
  if (!Array.isArray(value)) {
    return { items: [], resolvedItems: [], recoveredFromInvalid: true }
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]))
  const favoriteIds = new Set<string>()
  const resolvedItems = value.flatMap((candidate): ResolvedFavoriteItem[] => {
    if (!isFavoriteItem(candidate) || favoriteIds.has(candidate.favoriteId)) {
      return []
    }

    const session = sessionMap.get(candidate.sessionId)
    const principleCard = session ? findPrincipleCard(session) : null
    if (!session || !principleCard || principleCard.id !== candidate.cardId) {
      return []
    }

    favoriteIds.add(candidate.favoriteId)
    return [{
      item: candidate,
      session,
      principleCard,
      contentUpdated: candidate.contentVersion !== session.contentVersion,
    }]
  }).sort((left, right) => (
    Date.parse(right.item.createdAt) - Date.parse(left.item.createdAt)
  ))

  return {
    items: resolvedItems.map((entry) => entry.item),
    resolvedItems,
    recoveredFromInvalid: resolvedItems.length !== value.length,
  }
}

export function addFavorite(
  items: FavoriteItem[],
  session: TrainingSession,
  createdAt = new Date().toISOString(),
) {
  const principleCard = findPrincipleCard(session)
  if (!principleCard) return { items, item: null, changed: false }

  const favoriteId = createFavoriteId(session.sessionId, principleCard.id)
  const existing = items.find((item) => item.favoriteId === favoriteId)
  if (existing) return { items, item: existing, changed: false }

  const item: FavoriteItem = {
    favoriteId,
    sessionId: session.sessionId,
    contentVersion: session.contentVersion,
    cardId: principleCard.id,
    createdAt,
  }
  return { items: [item, ...items], item, changed: true }
}

export function removeFavorite(items: FavoriteItem[], favoriteId: string) {
  const nextItems = items.filter((item) => item.favoriteId !== favoriteId)
  return {
    items: nextItems,
    changed: nextItems.length !== items.length,
  }
}

export function isSessionFavorite(items: FavoriteItem[], session: TrainingSession) {
  const principleCard = findPrincipleCard(session)
  return Boolean(principleCard && items.some(
    (item) => item.favoriteId === createFavoriteId(session.sessionId, principleCard.id),
  ))
}
