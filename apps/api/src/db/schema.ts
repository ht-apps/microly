import type { AnalyticsEvent, TrainingCompletion } from '@microly/api-contract'
import type { TrainingContentBundle } from '@microly/content-schema'
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const guestIdentities = pgTable('guest_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  installationHash: varchar('installation_hash', { length: 64 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  guestId: uuid('guest_id').notNull().references(() => guestIdentities.id, { onDelete: 'cascade' }),
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
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
})

export const trainingCompletions = pgTable('training_completions', {
  id: uuid('id').primaryKey().defaultRandom(),
  guestId: uuid('guest_id').notNull().references(() => guestIdentities.id, { onDelete: 'cascade' }),
  syncId: text('sync_id').notNull(),
  sessionId: varchar('session_id', { length: 100 }).notNull(),
  contentVersion: integer('content_version').notNull(),
  selectedOptionId: varchar('selected_option_id', { length: 100 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('training_completions_guest_sync_idx').on(table.guestId, table.syncId),
])

export const analyticsEvents = pgTable('analytics_events', {
  eventId: uuid('event_id').primaryKey(),
  guestId: uuid('guest_id').notNull().references(() => guestIdentities.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 60 }).$type<AnalyticsEvent['name']>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  properties: jsonb('properties').$type<AnalyticsEvent['properties']>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})

export type StoredTrainingCompletion = typeof trainingCompletions.$inferSelect
export type NewTrainingCompletion = TrainingCompletion
