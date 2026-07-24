import type {
  AnalyticsEvent,
  FavoriteSyncRecord,
  LearningActivitySyncRecord,
  ReviewSyncRecord,
  SyncPreference,
  TrainingCompletion,
  TrainingProgressSyncRecord,
} from '@microly/api-contract'
import type { TrainingContentBundle } from '@microly/content-schema'
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { AiEvaluationResult } from '@microly/api-contract'

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  authType: varchar('auth_type', { length: 20 }).$type<'guest' | 'wechat'>().notNull().default('guest'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const guestIdentities = pgTable('guest_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  installationHash: varchar('installation_hash', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const wechatIdentities = pgTable('wechat_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  appId: varchar('app_id', { length: 64 }).notNull(),
  openidHash: varchar('openid_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('wechat_identities_app_openid_idx').on(table.appId, table.openidHash),
])

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contentReleases = pgTable('content_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  releaseVersion: integer('release_version').notNull().unique(),
  bundle: jsonb('bundle').$type<TrainingContentBundle>().notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  sourceDraftId: uuid('source_draft_id'),
  createdFromVersion: integer('created_from_version'),
  releaseReason: text('release_reason'),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contentDrafts = pgTable('content_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  baseReleaseVersion: integer('base_release_version'),
  bundle: jsonb('bundle').$type<unknown>().notNull(),
  status: varchar('status', { length: 20 }).$type<'draft' | 'published' | 'abandoned'>().notNull().default('draft'),
  revision: integer('revision').notNull().default(1),
  publishedReleaseVersion: integer('published_release_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  action: varchar('action', { length: 60 }).notNull(),
  targetType: varchar('target_type', { length: 40 }).notNull(),
  targetId: text('target_id').notNull(),
  reason: text('reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const trainingCompletions = pgTable('training_completions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  syncId: text('sync_id').notNull(),
  sessionId: varchar('session_id', { length: 100 }).notNull(),
  contentVersion: integer('content_version').notNull(),
  selectedOptionId: varchar('selected_option_id', { length: 100 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('training_completions_account_sync_idx').on(table.accountId, table.syncId),
])

export const analyticsEvents = pgTable('analytics_events', {
  eventId: uuid('event_id').primaryKey(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 60 }).$type<AnalyticsEvent['name']>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  properties: jsonb('properties').$type<AnalyticsEvent['properties']>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userPreferences = pgTable('user_preferences', {
  accountId: uuid('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  value: jsonb('value').$type<SyncPreference>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

export const favoriteStates = pgTable('favorite_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  favoriteId: text('favorite_id').notNull(),
  value: jsonb('value').$type<FavoriteSyncRecord>().notNull(),
  active: boolean('active').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('favorite_states_account_item_idx').on(table.accountId, table.favoriteId)])

export const reviewStates = pgTable('review_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  reviewId: text('review_id').notNull(),
  value: jsonb('value').$type<ReviewSyncRecord>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('review_states_account_item_idx').on(table.accountId, table.reviewId)])

export const trainingProgressStates = pgTable('training_progress_states', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  sessionId: varchar('session_id', { length: 100 }).notNull(),
  value: jsonb('value').$type<TrainingProgressSyncRecord>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('training_progress_account_session_idx').on(table.accountId, table.sessionId)])

export const learningActivityEvents = pgTable('learning_activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: text('event_id').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  value: jsonb('value').$type<LearningActivitySyncRecord>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('learning_activity_account_event_idx').on(table.accountId, table.eventId)])

export const syncRequests = pgTable('sync_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('sync_requests_account_request_idx').on(table.accountId, table.requestId)])

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  category: varchar('category', { length: 40 }).notNull(),
  detail: text('detail').notNull(),
  sessionId: varchar('session_id', { length: 100 }),
  contentVersion: integer('content_version'),
  status: varchar('status', { length: 20 }).notNull().default('new'),
  internalNote: text('internal_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

export const aiModelConfigs = pgTable('ai_model_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: varchar('provider', { length: 30 }).$type<'deepseek'>().notNull().default('deepseek'),
  modelId: varchar('model_id', { length: 100 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }).notNull(),
  thinkingEnabled: boolean('thinking_enabled').notNull().default(false),
  maxTokens: integer('max_tokens').notNull().default(800),
  temperature: doublePrecision('temperature').notNull().default(0.2),
  timeoutMs: integer('timeout_ms').notNull().default(30000),
  dailyQuota: integer('daily_quota').notNull().default(5),
  inputCacheHitPrice: doublePrecision('input_cache_hit_price').notNull().default(0),
  inputCacheMissPrice: doublePrecision('input_cache_miss_price').notNull().default(0),
  outputPrice: doublePrecision('output_price').notNull().default(0),
  active: boolean('active').notNull().default(false),
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const aiEvaluations = pgTable('ai_evaluations', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull(),
  attemptId: text('attempt_id').notNull(),
  sessionId: varchar('session_id', { length: 100 }).notNull(),
  contentVersion: integer('content_version').notNull(),
  practiceCardId: varchar('practice_card_id', { length: 100 }).notNull(),
  inputDigest: varchar('input_digest', { length: 64 }).notNull(),
  status: varchar('status', { length: 20 }).$type<'queued' | 'processing' | 'succeeded' | 'degraded' | 'blocked' | 'canceled'>().notNull(),
  fallbackResult: jsonb('fallback_result').$type<AiEvaluationResult>().notNull(),
  result: jsonb('result').$type<AiEvaluationResult>(),
  provider: varchar('provider', { length: 30 }).notNull().default('deepseek'),
  modelId: varchar('model_id', { length: 100 }).notNull(),
  configRevision: integer('config_revision').notNull(),
  promptVersion: varchar('prompt_version', { length: 80 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  promptCacheHitTokens: integer('prompt_cache_hit_tokens').notNull().default(0),
  promptCacheMissTokens: integer('prompt_cache_miss_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull().default(0),
  latencyMs: integer('latency_ms'),
  formatRetries: integer('format_retries').notNull().default(0),
  failureCode: varchar('failure_code', { length: 80 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('ai_evaluations_account_request_idx').on(table.accountId, table.requestId),
  uniqueIndex('ai_evaluations_account_attempt_card_idx').on(table.accountId, table.attemptId, table.practiceCardId),
])

export const aiEvaluationRatings = pgTable('ai_evaluation_ratings', {
  evaluationId: uuid('evaluation_id').primaryKey().references(() => aiEvaluations.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  helpful: boolean('helpful').notNull(),
  reason: varchar('reason', { length: 40 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const adminAiGenerationRuns = pgTable('admin_ai_generation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  operation: varchar('operation', { length: 40 }).notNull(),
  targetId: text('target_id').notNull(),
  provider: varchar('provider', { length: 30 }).notNull().default('deepseek'),
  modelId: varchar('model_id', { length: 100 }).notNull(),
  configRevision: integer('config_revision').notNull(),
  promptVersion: varchar('prompt_version', { length: 80 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull().default(0),
  latencyMs: integer('latency_ms'),
  formatRetries: integer('format_retries').notNull().default(0),
  failureCode: varchar('failure_code', { length: 80 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type StoredTrainingCompletion = typeof trainingCompletions.$inferSelect
export type NewTrainingCompletion = TrainingCompletion
