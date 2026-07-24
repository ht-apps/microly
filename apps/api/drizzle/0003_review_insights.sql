CREATE TABLE IF NOT EXISTS admin_ai_generation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation varchar(40) NOT NULL,
  target_id text NOT NULL,
  provider varchar(30) NOT NULL DEFAULT 'deepseek',
  model_id varchar(100) NOT NULL,
  config_revision integer NOT NULL,
  prompt_version varchar(80) NOT NULL,
  status varchar(20) NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd double precision NOT NULL DEFAULT 0,
  latency_ms integer,
  format_retries integer NOT NULL DEFAULT 0,
  failure_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_ai_generation_runs_created_idx ON admin_ai_generation_runs (created_at DESC);

UPDATE review_states
SET value = value || '{"reviewCount":0,"lastVariantId":null}'::jsonb
WHERE NOT (value ? 'reviewCount');
