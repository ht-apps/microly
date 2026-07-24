CREATE TABLE IF NOT EXISTS client_error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fingerprint varchar(64) NOT NULL,
  category varchar(30) NOT NULL,
  severity varchar(12) NOT NULL,
  page varchar(120) NOT NULL,
  app_version varchar(40) NOT NULL,
  content_version integer,
  network_type varchar(20) NOT NULL,
  error_code varchar(80),
  stack_digest varchar(64),
  status varchar(20) NOT NULL DEFAULT 'new',
  internal_note text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS client_error_reports_received_idx ON client_error_reports (received_at DESC);
CREATE INDEX IF NOT EXISTS client_error_reports_fingerprint_idx ON client_error_reports (fingerprint, received_at DESC);
CREATE INDEX IF NOT EXISTS client_error_reports_account_rate_idx ON client_error_reports (account_id, received_at DESC);
