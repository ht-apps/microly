import { createHash } from 'node:crypto'

import type { AdminLearningQuality, ContentQualityIssue } from '@microly/api-contract'
import { TrainingContentBundleSchema, type TrainingContentBundle } from '@microly/content-schema'

import type { DatabaseContext } from './db/client.js'

type Window = '7d' | '30d'
type EventRow = { account_id: string; name: string; occurred_at: Date; local_date_key: string | null; properties: Record<string, unknown> }
type ActivityRow = { account_id: string; occurred_at: Date; value: Record<string, unknown> }

export interface LearningQualityQuery {
  window: Window
  releaseVersion?: number
  catalogId?: string
  sessionId?: string
}

const DAY = 86_400_000
const EXIT_MATURITY = DAY

function rate(numerator: number, denominator: number) {
  return denominator ? Math.min(1, numerator / denominator) : null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateKeyForOffset(value: Date, offsetMinutes: number) {
  return new Date(value.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10)
}

function startOfWeek(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  const weekday = date.getUTCDay()
  return addDays(dateKey, -(weekday === 0 ? 6 : weekday - 1))
}

function propertyString(row: EventRow, key: string) {
  const value = row.properties[key]
  return typeof value === 'string' ? value : ''
}

function propertyNumber(row: EventRow, key: string) {
  const value = row.properties[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function issueKey(releaseVersion: number, sessionId: string, signal: string, suffix = '') {
  return createHash('sha256').update(`${releaseVersion}:${sessionId}:${signal}:${suffix}`).digest('hex')
}

function catalogForSession(bundle: TrainingContentBundle, sessionId: string) {
  return Object.values(bundle.catalogs).find((catalog) => catalog.sessionIds.includes(sessionId))
}

function effectiveDates(activities: ActivityRow[]) {
  const byAccount = new Map<string, Map<string, { trainings: Set<string>; reviews: number; hasReview: boolean }>>()
  for (const row of activities) {
    const date = typeof row.value.localDateKey === 'string' ? row.value.localDateKey : ''
    if (!date) continue
    const account = byAccount.get(row.account_id) ?? new Map()
    const current = account.get(date) ?? { trainings: new Set<string>(), reviews: 0, hasReview: false }
    if (row.value.type === 'training_completed' && typeof row.value.sessionId === 'string') current.trainings.add(row.value.sessionId)
    if (row.value.type === 'due_review_answered') { current.reviews += 1; current.hasReview = true }
    account.set(date, current)
    byAccount.set(row.account_id, account)
  }
  return byAccount
}

function buildIssue(
  releaseVersion: number,
  sessionId: string,
  sessionTitle: string,
  signal: ContentQualityIssue['signal'],
  message: string,
  sampleSize: number,
  value: number | null,
  threshold: number | null,
  severity: ContentQualityIssue['severity'] = 'attention',
  suffix = '',
): ContentQualityIssue {
  return {
    issueKey: issueKey(releaseVersion, sessionId, signal, suffix), signal, severity, releaseVersion,
    sessionId, sessionTitle, value, threshold, sampleSize, message, status: 'open', internalNote: null, updatedAt: null,
  }
}

export async function buildLearningQuality(
  database: DatabaseContext,
  query: LearningQualityQuery,
  now = new Date(),
): Promise<AdminLearningQuality> {
  const days = query.window === '7d' ? 7 : 30
  const since = new Date(now.getTime() - days * DAY)
  const eventSince = new Date(now.getTime() - (days + 8) * DAY)
  const releasesResult = await database.pool.query(`SELECT release_version, bundle, published_at FROM content_releases ORDER BY release_version DESC`)
  const releases = releasesResult.rows.flatMap((row) => {
    const parsed = TrainingContentBundleSchema.safeParse(row.bundle)
    return parsed.success ? [{ releaseVersion: Number(row.release_version), bundle: parsed.data, publishedAt: row.published_at as Date }] : []
  })
  const current = releases[0]
  if (!current) throw new Error('No content release is available')
  const selected = releases.find((item) => item.releaseVersion === query.releaseVersion) ?? current
  const bundle = selected.bundle
  const allowedSessionIds = new Set(Object.keys(bundle.sessions).filter((sessionId) => {
    if (query.sessionId && sessionId !== query.sessionId) return false
    const catalog = catalogForSession(bundle, sessionId)
    return !query.catalogId || catalog?.catalogId === query.catalogId
  }))

  const [eventsResult, factsResult, activitiesResult, occurrencesResult, feedbackResult, statesResult, coverageResult] = await Promise.all([
    database.pool.query(`SELECT account_id, name, occurred_at, local_date_key::text, properties FROM analytics_events WHERE occurred_at >= $1 ORDER BY occurred_at`, [eventSince]),
    database.pool.query(`SELECT account_id, first_opened_at, first_opened_local_date::text, timezone_offset_minutes FROM analytics_account_facts WHERE first_opened_at >= $1`, [since]),
    database.pool.query(`SELECT account_id, occurred_at, value FROM learning_activity_events ORDER BY occurred_at`),
    database.pool.query(`SELECT account_id, review_id, session_id, content_version, scheduled_due_at, answered_at FROM review_schedule_occurrences WHERE scheduled_due_at >= $1 AND scheduled_due_at <= $2`, [since, now]),
    database.pool.query(`SELECT session_id, content_version, category, status, created_at FROM feedback WHERE created_at >= $1 AND session_id IS NOT NULL`, [since]),
    database.pool.query(`SELECT issue_key, status, internal_note, updated_at FROM content_quality_issue_states`),
    database.pool.query(`SELECT min(occurred_at) started_at FROM analytics_events WHERE name='training_start' AND properties ? 'releaseVersion'`),
  ])
  const events = eventsResult.rows as EventRow[]
  const windowEvents = events.filter((row) => row.occurred_at >= since)
  const activities = activitiesResult.rows as ActivityRow[]
  const effective = effectiveDates(activities)
  const eventDate = (row: EventRow) => row.local_date_key || dateKeyForOffset(row.occurred_at, 0)

  const firstOpenFacts = factsResult.rows as Array<{ account_id: string; first_opened_at: Date; first_opened_local_date: string; timezone_offset_minutes: number }>
  const starts = events.filter((row) => row.name === 'training_start')
  const completes = events.filter((row) => row.name === 'training_complete')
  let firstTrainingStartedAccounts = 0
  let firstTrainingCompletedAccounts = 0
  for (const fact of firstOpenFacts) {
    const firstStart = starts.find((row) => row.account_id === fact.account_id && row.occurred_at >= fact.first_opened_at && row.occurred_at.getTime() <= fact.first_opened_at.getTime() + DAY)
    if (!firstStart) continue
    firstTrainingStartedAccounts += 1
    const attemptId = propertyString(firstStart, 'attemptId')
    if (completes.some((row) => row.account_id === fact.account_id && propertyString(row, 'attemptId') === attemptId)) firstTrainingCompletedAccounts += 1
  }

  const firstCompletionByAccount = new Map<string, ActivityRow>()
  for (const row of activities) {
    if (row.value.type !== 'training_completed') continue
    const existing = firstCompletionByAccount.get(row.account_id)
    if (!existing || row.occurred_at < existing.occurred_at) firstCompletionByAccount.set(row.account_id, row)
  }
  const trend = new Map<string, { firstCompletions: number; d1Eligible: number; d1Retained: number; sevenDayEligible: number; sevenDayThreePractice: number }>()
  let d1Eligible = 0; let d1Retained = 0; let sevenEligible = 0; let sevenThree = 0
  for (const [accountId, first] of firstCompletionByAccount) {
    const date = String(first.value.localDateKey ?? '')
    if (!date || first.occurred_at < since || first.occurred_at > now) continue
    const accountFact = firstOpenFacts.find((item) => item.account_id === accountId)
    const today = dateKeyForOffset(now, accountFact?.timezone_offset_minutes ?? -480)
    const item = trend.get(date) ?? { firstCompletions: 0, d1Eligible: 0, d1Retained: 0, sevenDayEligible: 0, sevenDayThreePractice: 0 }
    item.firstCompletions += 1
    const dates = effective.get(accountId) ?? new Map()
    if (date <= addDays(today, -1)) {
      d1Eligible += 1; item.d1Eligible += 1
      const next = dates.get(addDays(date, 1))
      if (next && (next.trainings.size > 0 || next.reviews >= 2)) { d1Retained += 1; item.d1Retained += 1 }
    }
    if (date <= addDays(today, -7)) {
      sevenEligible += 1; item.sevenDayEligible += 1
      const learnedDays = Array.from({ length: 7 }, (_, index) => dates.get(addDays(date, index)))
        .filter((day) => day && (day.trainings.size > 0 || day.reviews >= 2)).length
      if (learnedDays >= 3) { sevenThree += 1; item.sevenDayThreePractice += 1 }
    }
    trend.set(date, item)
  }

  const selectedEvents = windowEvents.filter((row) => {
    const release = propertyNumber(row, 'releaseVersion')
    const sessionId = propertyString(row, 'sessionId')
    return release === selected.releaseVersion && (!sessionId || allowedSessionIds.has(sessionId))
  })
  const selectedCompletes = selectedEvents.filter((row) => row.name === 'training_complete')
  const dueRows = occurrencesResult.rows.filter((row) => allowedSessionIds.has(row.session_id))
  const dueCompleted = dueRows.filter((row) => row.answered_at && new Date(row.answered_at).getTime() <= new Date(row.scheduled_due_at).getTime() + 2 * DAY).length
  const currentDate = dateKeyForOffset(now, -480)
  const weekStart = startOfWeek(currentDate)
  let welAccounts = 0
  for (const [accountId, dates] of effective) {
    const weekDays = [...dates.entries()].filter(([date, item]) => date >= weekStart && date <= currentDate && (item.trainings.size > 0 || item.reviews >= 2))
    const hasReview = weekDays.some(([, item]) => item.hasReview)
    const hasPractice = selectedCompletes.some((row) => row.account_id === accountId && row.properties.practiceUsed === true && eventDate(row) >= weekStart)
    if (weekDays.length >= 3 && (hasReview || hasPractice)) welAccounts += 1
  }

  const feedbackRows = feedbackResult.rows as Array<{ session_id: string; content_version: number; category: string; status: string; created_at: Date }>
  const activityWindow = activities.filter((row) => row.occurred_at >= since)
  const sessions: AdminLearningQuality['sessions'] = []
  for (const sessionId of allowedSessionIds) {
    const session = bundle.sessions[sessionId]!
    const catalog = catalogForSession(bundle, sessionId)!
    const own = selectedEvents.filter((row) => propertyString(row, 'sessionId') === sessionId)
    const ownStarts = new Set(own.filter((row) => row.name === 'training_start').map((row) => propertyString(row, 'attemptId')).filter(Boolean))
    const ownCompletes = own.filter((row) => row.name === 'training_complete')
    const completeAttempts = new Set(ownCompletes.map((row) => propertyString(row, 'attemptId')).filter(Boolean))
    const durations = ownCompletes.flatMap((row) => { const value = propertyNumber(row, 'durationMs'); return value === null ? [] : [Math.round(value)] })
    const optionRatings = { recommended: 0, risky: 0, not_recommended: 0 }
    own.filter((row) => row.name === 'option_select').forEach((row) => {
      const rating = propertyString(row, 'rating') as keyof typeof optionRatings
      if (rating in optionRatings) optionRatings[rating] += 1
    })
    const views = own.filter((row) => row.name === 'training_card_view')
    const lastViewByAttempt = new Map<string, EventRow>()
    views.forEach((row) => {
      const attempt = propertyString(row, 'attemptId')
      const previous = lastViewByAttempt.get(attempt)
      if (!previous || previous.occurred_at < row.occurred_at) lastViewByAttempt.set(attempt, row)
    })
    const cards = session.cards.map((card, cardIndex) => {
      const cardRows = views.filter((row) => propertyString(row, 'cardId') === card.id)
      const attemptViews = new Map<string, EventRow>()
      cardRows.forEach((row) => attemptViews.set(propertyString(row, 'attemptId'), row))
      const mature = [...attemptViews.values()].filter((row) => row.occurred_at.getTime() <= now.getTime() - EXIT_MATURITY)
      const exits = mature.filter((row) => {
        const attempt = propertyString(row, 'attemptId')
        return lastViewByAttempt.get(attempt) === row && !completeAttempts.has(attempt)
      }).length
      return { cardId: card.id, cardType: card.type, cardIndex, views: attemptViews.size, matureViews: mature.length, exits, exitRate: rate(exits, mature.length) }
    })
    const topExitCard = [...cards].filter((card) => card.exitRate !== null).sort((left, right) => (right.exitRate ?? 0) - (left.exitRate ?? 0))[0] ?? null
    const reviews = activityWindow.filter((row) => row.value.type === 'due_review_answered' && row.value.sessionId === sessionId)
    const original = reviews.filter((row) => !row.value.variantId && typeof row.value.isCorrect === 'boolean')
    const variants = reviews.filter((row) => row.value.variantId && typeof row.value.isCorrect === 'boolean')
    const correctRate = (rows: ActivityRow[]) => rate(rows.filter((row) => row.value.isCorrect === true).length, rows.length)
    const versionHistory = releases.flatMap((release) => {
      const versionSession = release.bundle.sessions[sessionId]
      if (!versionSession) return []
      const versionEvents = windowEvents.filter((row) => propertyNumber(row, 'releaseVersion') === release.releaseVersion && propertyString(row, 'sessionId') === sessionId)
      const starts = new Set(versionEvents.filter((row) => row.name === 'training_start').map((row) => propertyString(row, 'attemptId')).filter(Boolean)).size
      const completes = versionEvents.filter((row) => row.name === 'training_complete')
      return [{
        releaseVersion: release.releaseVersion, contentVersion: versionSession.contentVersion, starts,
        completions: new Set(completes.map((row) => propertyString(row, 'attemptId')).filter(Boolean)).size,
        completionRate: rate(new Set(completes.map((row) => propertyString(row, 'attemptId')).filter(Boolean)).size, starts),
        medianDurationMs: median(completes.flatMap((row) => { const value = propertyNumber(row, 'durationMs'); return value === null ? [] : [value] })),
      }]
    })
    sessions.push({
      sessionId, title: session.title, catalogId: catalog.catalogId, catalogTitle: catalog.title,
      releaseVersion: selected.releaseVersion, contentVersion: session.contentVersion,
      starts: ownStarts.size, completions: completeAttempts.size, completionRate: rate(completeAttempts.size, ownStarts.size),
      medianDurationMs: median(durations), activePracticeRate: rate(ownCompletes.filter((row) => row.properties.practiceUsed === true).length, ownCompletes.length),
      optionRatings, feedbackCount: feedbackRows.filter((row) => row.session_id === sessionId && Number(row.content_version) === session.contentVersion).length,
      sampleSufficient: ownStarts.size >= 10, topExitCard, cards,
      originalReviewAnswers: original.length, originalReviewCorrectRate: correctRate(original),
      variantReviewAnswers: variants.length, variantReviewCorrectRate: correctRate(variants), versionHistory,
    })
  }

  const generatedIssues: ContentQualityIssue[] = []
  if (selected.releaseVersion === current.releaseVersion) {
    for (const session of sessions) {
      if (session.starts >= 10 && (session.completionRate ?? 1) < 0.65) generatedIssues.push(buildIssue(selected.releaseVersion, session.sessionId, session.title, 'low_completion', '训练完成率低于封测目标 65%。', session.starts, session.completionRate, 0.65))
      if (session.completions >= 10 && session.medianDurationMs !== null && (session.medianDurationMs < 120_000 || session.medianDurationMs > 300_000)) generatedIssues.push(buildIssue(selected.releaseVersion, session.sessionId, session.title, 'duration_outlier', '中位活跃训练时长不在 2～5 分钟目标区间。', session.completions, session.medianDurationMs, session.medianDurationMs < 120_000 ? 120_000 : 300_000))
      if (session.completions >= 10 && (session.activePracticeRate ?? 1) < 0.25) generatedIssues.push(buildIssue(selected.releaseVersion, session.sessionId, session.title, 'low_practice', '主动表达练习率低于封测目标 25%。', session.completions, session.activePracticeRate, 0.25))
      for (const card of session.cards) if (card.matureViews >= 10 && (card.exitRate ?? 0) > 0.3) generatedIssues.push(buildIssue(selected.releaseVersion, session.sessionId, session.title, 'high_card_exit', `${card.cardType} 卡片的 24 小时成熟退出率高于 30%。`, card.matureViews, card.exitRate, 0.3, 'attention', card.cardId))
      if (session.originalReviewAnswers >= 10 && session.variantReviewAnswers >= 10 && session.originalReviewCorrectRate !== null && session.variantReviewCorrectRate !== null && session.originalReviewCorrectRate - session.variantReviewCorrectRate >= 0.2) generatedIssues.push(buildIssue(selected.releaseVersion, session.sessionId, session.title, 'weak_review_variant', '复习变体正确率比原题低至少 20 个百分点。', session.originalReviewAnswers + session.variantReviewAnswers, session.variantReviewCorrectRate, session.originalReviewCorrectRate - 0.2))
      const riskyFeedback = feedbackRows.filter((row) => row.session_id === session.sessionId && ['content_error', 'inappropriate_content'].includes(row.category) && ['new', 'in_progress'].includes(row.status))
      if (riskyFeedback.length) generatedIssues.push(buildIssue(selected.releaseVersion, session.sessionId, session.title, 'content_feedback', `存在 ${riskyFeedback.length} 条未处理的内容错误或不当内容反馈。`, riskyFeedback.length, null, null, riskyFeedback.some((row) => row.category === 'inappropriate_content') ? 'critical' : 'attention'))
    }
  }
  const states = new Map(statesResult.rows.map((row) => [row.issue_key as string, row]))
  const issues = generatedIssues.map((issue) => {
    const state = states.get(issue.issueKey)
    return state ? { ...issue, status: state.status, internalNote: state.internal_note, updatedAt: state.updated_at.toISOString() } : issue
  })
  const selectedStarts = new Set(selectedEvents.filter((row) => row.name === 'training_start').map((row) => propertyString(row, 'attemptId')).filter(Boolean))
  return {
    window: query.window, generatedAt: now.toISOString(), coverageStartedAt: coverageResult.rows[0]?.started_at?.toISOString() ?? null,
    selectedReleaseVersion: selected.releaseVersion, currentReleaseVersion: current.releaseVersion,
    filters: {
      releases: releases.map((release) => ({ releaseVersion: release.releaseVersion, publishedAt: release.publishedAt.toISOString() })),
      catalogs: Object.values(bundle.catalogs).map((catalog) => ({ catalogId: catalog.catalogId, title: catalog.title })),
      sessions: Object.values(bundle.sessions).map((session) => ({ sessionId: session.sessionId, title: session.title, catalogId: catalogForSession(bundle, session.sessionId)?.catalogId ?? session.skill })),
    },
    summary: {
      firstOpenAccounts: firstOpenFacts.length, firstTrainingStartedAccounts,
      firstTrainingStartRate: rate(firstTrainingStartedAccounts, firstOpenFacts.length),
      firstTrainingCompletedAccounts, firstTrainingCompletionRate: rate(firstTrainingCompletedAccounts, firstTrainingStartedAccounts),
      d1EligibleAccounts: d1Eligible, d1RetainedAccounts: d1Retained, d1RetentionRate: rate(d1Retained, d1Eligible),
      sevenDayEligibleAccounts: sevenEligible, sevenDayThreePracticeAccounts: sevenThree, sevenDayThreePracticeRate: rate(sevenThree, sevenEligible),
      completedAttempts: new Set(selectedCompletes.map((row) => propertyString(row, 'attemptId')).filter(Boolean)).size,
      activePracticeRate: rate(selectedCompletes.filter((row) => row.properties.practiceUsed === true).length, selectedCompletes.length),
      medianDurationMs: median(selectedCompletes.flatMap((row) => { const value = propertyNumber(row, 'durationMs'); return value === null ? [] : [value] })),
      dueReviewOccurrences: dueRows.length, dueReviewCompleted: dueCompleted, dueReviewCompletionRate: rate(dueCompleted, dueRows.length),
      welAccounts,
      openIssueCount: new Set(issues.filter((issue) => ['open', 'in_progress'].includes(issue.status)).map((issue) => issue.sessionId)).size,
    },
    retentionTrend: [...trend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, item]) => ({ date, ...item })),
    sessions: sessions.sort((left, right) => right.starts - left.starts || left.sessionId.localeCompare(right.sessionId)), issues,
  }
}
