CREATE TABLE IF NOT EXISTS ai_model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(30) NOT NULL DEFAULT 'deepseek',
  model_id varchar(100) NOT NULL UNIQUE,
  display_name varchar(120) NOT NULL,
  thinking_enabled boolean NOT NULL DEFAULT false,
  max_tokens integer NOT NULL DEFAULT 800 CHECK (max_tokens BETWEEN 100 AND 4000),
  temperature double precision NOT NULL DEFAULT 0.2 CHECK (temperature BETWEEN 0 AND 2),
  timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 5000 AND 60000),
  daily_quota integer NOT NULL DEFAULT 5 CHECK (daily_quota BETWEEN 1 AND 100),
  input_cache_hit_price double precision NOT NULL DEFAULT 0 CHECK (input_cache_hit_price >= 0),
  input_cache_miss_price double precision NOT NULL DEFAULT 0 CHECK (input_cache_miss_price >= 0),
  output_price double precision NOT NULL DEFAULT 0 CHECK (output_price >= 0),
  active boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_configs_one_active_idx ON ai_model_configs (active) WHERE active = true;

INSERT INTO ai_model_configs
  (model_id, display_name, active, input_cache_hit_price, input_cache_miss_price, output_price)
VALUES
  ('deepseek-v4-flash', 'DeepSeek V4 Flash', true, 0.0028, 0.14, 0.28),
  ('deepseek-v4-pro', 'DeepSeek V4 Pro', false, 0.003625, 0.435, 0.87)
ON CONFLICT (model_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  attempt_id text NOT NULL,
  session_id varchar(100) NOT NULL,
  content_version integer NOT NULL,
  practice_card_id varchar(100) NOT NULL,
  input_digest varchar(64) NOT NULL,
  status varchar(20) NOT NULL,
  fallback_result jsonb NOT NULL,
  result jsonb,
  provider varchar(30) NOT NULL DEFAULT 'deepseek',
  model_id varchar(100) NOT NULL,
  config_revision integer NOT NULL,
  prompt_version varchar(80) NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  prompt_cache_hit_tokens integer NOT NULL DEFAULT 0,
  prompt_cache_miss_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd double precision NOT NULL DEFAULT 0,
  latency_ms integer,
  format_retries integer NOT NULL DEFAULT 0,
  failure_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT ai_evaluations_account_request_unique UNIQUE (account_id, request_id),
  CONSTRAINT ai_evaluations_account_attempt_card_unique UNIQUE (account_id, attempt_id, practice_card_id)
);
CREATE INDEX IF NOT EXISTS ai_evaluations_account_created_idx ON ai_evaluations (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_evaluation_ratings (
  evaluation_id uuid PRIMARY KEY REFERENCES ai_evaluations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  helpful boolean NOT NULL,
  reason varchar(40),
  updated_at timestamptz NOT NULL DEFAULT now()
);
