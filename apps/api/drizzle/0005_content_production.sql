CREATE TABLE IF NOT EXISTS admin_content_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  draft_id uuid NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  catalog_id varchar(100) NOT NULL,
  draft_revision integer NOT NULL,
  operation varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  requested_count integer NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  inserted_candidate_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_id varchar(100),
  config_revision integer,
  prompt_version varchar(80),
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd double precision NOT NULL DEFAULT 0,
  latency_ms integer,
  format_retries integer NOT NULL DEFAULT 0,
  failure_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_content_generation_jobs_operation_check CHECK (operation IN ('session_outlines', 'training_sessions')),
  CONSTRAINT admin_content_generation_jobs_status_check CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT admin_content_generation_jobs_count_check CHECK (requested_count BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS admin_content_generation_jobs_draft_created_idx
  ON admin_content_generation_jobs (draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_content_generation_jobs_status_idx
  ON admin_content_generation_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS content_session_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
  session_id varchar(100) NOT NULL,
  content_digest varchar(64) NOT NULL,
  checklist jsonb NOT NULL,
  operator_label varchar(50) NOT NULL,
  reviewer_label varchar(50),
  note text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, session_id)
);

CREATE INDEX IF NOT EXISTS content_session_reviews_draft_idx
  ON content_session_reviews (draft_id, session_id);
