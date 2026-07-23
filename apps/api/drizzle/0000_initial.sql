CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_type varchar(20) NOT NULL DEFAULT 'guest',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  installation_hash varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wechat_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  app_id varchar(64) NOT NULL,
  openid_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wechat_identities_app_openid_unique UNIQUE (app_id, openid_hash)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
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
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sync_id text NOT NULL,
  session_id varchar(100) NOT NULL,
  content_version integer NOT NULL CHECK (content_version > 0),
  selected_option_id varchar(100) NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_completions_account_sync_unique UNIQUE (account_id, sync_id),
  CONSTRAINT training_completions_time_order CHECK (started_at <= completed_at)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  event_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  occurred_at timestamptz NOT NULL,
  properties jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS favorite_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  favorite_id text NOT NULL,
  value jsonb NOT NULL,
  active boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT favorite_states_account_item_unique UNIQUE (account_id, favorite_id)
);

CREATE TABLE IF NOT EXISTS review_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  review_id text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT review_states_account_item_unique UNIQUE (account_id, review_id)
);

CREATE TABLE IF NOT EXISTS training_progress_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id varchar(100) NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT training_progress_account_session_unique UNIQUE (account_id, session_id)
);

CREATE TABLE IF NOT EXISTS learning_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  value jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT learning_activity_account_event_unique UNIQUE (account_id, event_id)
);

CREATE TABLE IF NOT EXISTS sync_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_requests_account_request_unique UNIQUE (account_id, request_id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category varchar(40) NOT NULL,
  detail text NOT NULL,
  session_id varchar(100),
  content_version integer,
  status varchar(20) NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
