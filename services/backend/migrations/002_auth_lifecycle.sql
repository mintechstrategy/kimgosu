-- KG-AUTH-BACKEND-01 additive only. 001 is immutable.
-- Rollback strategy: roll application back; keep additive schema/data. No DOWN/DROP.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
ALTER TABLE kg_membership.members ADD COLUMN IF NOT EXISTS phone_digest char(64);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_member_per_phone ON kg_membership.members(phone_digest) WHERE withdrawn_at IS NULL AND phone_digest IS NOT NULL;
ALTER TABLE kg_membership.sessions ADD COLUMN IF NOT EXISTS refresh_digest char(64);
ALTER TABLE kg_membership.sessions ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz;
ALTER TABLE kg_membership.sessions ADD COLUMN IF NOT EXISTS family_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS unique_refresh_digest ON kg_membership.sessions(refresh_digest) WHERE refresh_digest IS NOT NULL;
CREATE TABLE IF NOT EXISTS kg_membership.oauth_flows (
  state_digest char(64) PRIMARY KEY,
  provider text NOT NULL CHECK(provider IN ('google','kakao','naver')),
  code_challenge varchar(43) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kg_membership.registration_tickets (
  ticket_digest char(64) PRIMARY KEY,
  provider text NOT NULL CHECK(provider IN ('google','kakao','naver')),
  subject_digest char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  phone_digest char(64),
  phone_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kg_membership.sms_challenges (
  id uuid PRIMARY KEY,
  ticket_digest char(64) NOT NULL REFERENCES kg_membership.registration_tickets(ticket_digest),
  phone_digest char(64) NOT NULL,
  code_mac char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  verified_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_sms_per_ticket ON kg_membership.sms_challenges(ticket_digest) WHERE invalidated_at IS NULL AND verified_at IS NULL;
CREATE INDEX IF NOT EXISTS sms_phone_rate_window ON kg_membership.sms_challenges(phone_digest,created_at DESC);
GRANT SELECT, INSERT, UPDATE ON kg_membership.oauth_flows,kg_membership.registration_tickets,kg_membership.sms_challenges TO kg_dev_runtime;
COMMIT;
