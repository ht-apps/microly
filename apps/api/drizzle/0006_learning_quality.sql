CREATE TABLE IF NOT EXISTS analytics_account_facts (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  first_opened_at timestamptz NOT NULL,
  first_opened_local_date date NOT NULL,
  timezone_offset_minutes integer NOT NULL CHECK (timezone_offset_minutes BETWEEN -840 AND 840),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS visit_id uuid;
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS local_date_key date;
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer;

CREATE TABLE IF NOT EXISTS review_schedule_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  review_id text NOT NULL,
  session_id varchar(100) NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  scheduled_due_at timestamptz NOT NULL,
  interval_days integer NOT NULL CHECK (interval_days IN (1, 3, 7, 14)),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_schedule_occurrences_unique UNIQUE (account_id, review_id, scheduled_due_at)
);

CREATE TABLE IF NOT EXISTS content_quality_issue_states (
  issue_key varchar(64) PRIMARY KEY,
  release_version integer NOT NULL CHECK (release_version > 0),
  session_id varchar(100) NOT NULL,
  signal varchar(40) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
  internal_note text,
  metric_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx ON analytics_events (name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_local_date_idx ON analytics_events (local_date_key, name);
CREATE INDEX IF NOT EXISTS analytics_events_session_time_idx
  ON analytics_events ((properties->>'sessionId'), occurred_at DESC)
  WHERE properties ? 'sessionId';
CREATE INDEX IF NOT EXISTS analytics_events_release_time_idx
  ON analytics_events (((properties->>'releaseVersion')::integer), occurred_at DESC)
  WHERE properties ? 'releaseVersion';
CREATE INDEX IF NOT EXISTS learning_activity_local_date_idx
  ON learning_activity_events ((value->>'localDateKey'), account_id);
CREATE INDEX IF NOT EXISTS review_occurrences_due_idx
  ON review_schedule_occurrences (scheduled_due_at, answered_at);
CREATE INDEX IF NOT EXISTS quality_issue_status_idx
  ON content_quality_issue_states (status, release_version, session_id);
