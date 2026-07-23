CREATE TABLE IF NOT EXISTS guest_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_hash varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guest_identities(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_version integer NOT NULL UNIQUE CHECK (release_version > 0),
  bundle jsonb NOT NULL,
  checksum varchar(64) NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guest_identities(id) ON DELETE CASCADE,
  sync_id text NOT NULL,
  session_id varchar(100) NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  selected_option_id varchar(100) NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_completions_guest_sync_unique UNIQUE (guest_id, sync_id),
  CONSTRAINT training_completions_time_order CHECK (started_at <= completed_at)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id uuid PRIMARY KEY,
  guest_id uuid NOT NULL REFERENCES guest_identities(id) ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  occurred_at timestamptz NOT NULL,
  properties jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
