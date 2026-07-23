ALTER TABLE content_releases ADD COLUMN IF NOT EXISTS source_draft_id uuid;
ALTER TABLE content_releases ADD COLUMN IF NOT EXISTS created_from_version integer;
ALTER TABLE content_releases ADD COLUMN IF NOT EXISTS release_reason text;

CREATE TABLE IF NOT EXISTS content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_release_version integer,
  bundle jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_release_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action varchar(60) NOT NULL,
  target_type varchar(40) NOT NULL,
  target_id text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS internal_note text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS analytics_events_account_name_time_idx
  ON analytics_events (account_id, name, occurred_at);
CREATE INDEX IF NOT EXISTS feedback_status_created_idx ON feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_drafts_status_updated_idx ON content_drafts (status, updated_at DESC);
