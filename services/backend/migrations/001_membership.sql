-- Additive first-membership schema. Apply only to the explicitly selected Railway development DB.
-- Withdrawal ends access; it does not erase earlier lifecycle/consent/trade data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
CREATE SCHEMA IF NOT EXISTS kg_membership;
CREATE TABLE IF NOT EXISTS kg_membership.principals (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kg_membership.members (
  id uuid PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES kg_membership.principals(id),
  customer_no bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESTRICTED','WITHDRAWN')),
  expert_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  rejoin_after timestamptz,
  retention_until timestamptz,
  CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL)),
  CHECK (withdrawn_at IS NULL OR (rejoin_after IS NOT NULL AND retention_until IS NOT NULL AND rejoin_after = withdrawn_at + interval '30 days' AND retention_until = withdrawn_at + interval '1 year'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_member_per_principal ON kg_membership.members(principal_id) WHERE withdrawn_at IS NULL;
CREATE TABLE IF NOT EXISTS kg_membership.social_links (
  provider text NOT NULL CHECK (provider IN ('kakao','naver','google')),
  subject_digest char(64) NOT NULL CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
  principal_id uuid NOT NULL REFERENCES kg_membership.principals(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider,subject_digest)
);
CREATE TABLE IF NOT EXISTS kg_membership.policy_documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('TERMS','PRIVACY_CONSENT','PRIVACY_POLICY','MARKETING','OPERATIONS')),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','READY','RETIRED')),
  title text NOT NULL,
  body text NOT NULL,
  body_sha256 char(64) NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  operator_name text,
  effective_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,version),
  CHECK (length(trim(version)) > 0 AND length(trim(title)) > 0 AND length(trim(body)) > 0),
  CHECK (status <> 'READY' OR (operator_name IS NOT NULL AND length(trim(operator_name)) > 0 AND effective_at IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS kg_membership.consent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES kg_membership.members(id),
  document_id bigint NOT NULL REFERENCES kg_membership.policy_documents(id),
  action text NOT NULL CHECK (action IN ('GRANTED','WITHDRAWN')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS consent_member_history ON kg_membership.consent_events(member_id,document_id,id DESC);
CREATE TABLE IF NOT EXISTS kg_membership.notification_preferences (
  member_id uuid PRIMARY KEY REFERENCES kg_membership.members(id),
  advertising boolean NOT NULL DEFAULT false,
  chat boolean NOT NULL DEFAULT false,
  comment boolean NOT NULL DEFAULT false,
  quote boolean NOT NULL DEFAULT false,
  inquiry boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kg_membership.sessions (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES kg_membership.members(id),
  access_digest char(64) NOT NULL UNIQUE CHECK (access_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_session_lookup ON kg_membership.sessions(member_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS kg_membership.restrictions (
  id uuid PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES kg_membership.principals(id),
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  revoked_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
GRANT USAGE ON SCHEMA kg_membership TO kg_dev_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA kg_membership TO kg_dev_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kg_membership TO kg_dev_runtime;
COMMIT;
