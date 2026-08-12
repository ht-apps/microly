CREATE TABLE IF NOT EXISTS runtime_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  minimum_supported_version varchar(40) NOT NULL DEFAULT '1.0.0',
  maintenance_active boolean NOT NULL DEFAULT false,
  maintenance_message varchar(200),
  features jsonb NOT NULL DEFAULT '{"wechatLogin":true,"accountSync":true,"aiEvaluation":true,"feedback":true}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO runtime_settings (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS deployment_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_version varchar(40) NOT NULL,
  git_commit varchar(40) NOT NULL,
  image_tag varchar(100) NOT NULL,
  migration_version text,
  content_version integer,
  status varchar(20) NOT NULL CHECK (status IN ('deploying','healthy','failed','rolled_back')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS deployment_releases_created_idx ON deployment_releases (created_at DESC);

CREATE TABLE IF NOT EXISTS database_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename varchar(200) NOT NULL UNIQUE,
  kind varchar(20) NOT NULL CHECK (kind IN ('scheduled','pre_release','manual')),
  status varchar(20) NOT NULL CHECK (status IN ('running','succeeded','failed')),
  size_bytes bigint,
  checksum varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  restore_verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS database_backups_created_idx ON database_backups (created_at DESC);

CREATE TABLE IF NOT EXISTS runtime_alert_states (
  alert_key varchar(100) PRIMARY KEY,
  level varchar(20) NOT NULL CHECK (level IN ('attention','critical')),
  active boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  recovered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
