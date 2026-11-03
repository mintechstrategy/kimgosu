-- Expert (고수) profile and service catalogue.
--
-- Scope (PLAN-WAVE2 / WS-13):
--   * expert_profiles : one row per expert member (member_id FK). Introduction,
--                       career, activity region and a public visibility status.
--   * expert_services : services an expert publishes. Visibility is explicit so
--                       the search API can return only visible rows.
--
-- EXPERT authority is the existing members.expert_active flag (migration 006);
-- role is re-verified on the server for every write, never taken from the client.
--
-- Additive only. No existing table is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.expert_profiles (
  member_id       uuid PRIMARY KEY REFERENCES kg_membership.members(id) ON DELETE CASCADE,
  introduction    text NOT NULL CHECK (length(trim(introduction)) BETWEEN 1 AND 1000),
  career          text CHECK (career IS NULL OR length(career) <= 2000),
  activity_region text NOT NULL CHECK (length(trim(activity_region)) BETWEEN 1 AND 100),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expert_profile_public ON kg_membership.expert_profiles(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS kg_membership.expert_services (
  id               uuid PRIMARY KEY,
  expert_member_id uuid NOT NULL REFERENCES kg_membership.expert_profiles(member_id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 50),
  title            text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  description      text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
  price_type       text NOT NULL CHECK (price_type IN ('FIXED','HOURLY','NEGOTIABLE')),
  base_price       integer CHECK (base_price IS NULL OR base_price >= 0),
  visibility       text NOT NULL DEFAULT 'VISIBLE' CHECK (visibility IN ('VISIBLE','HIDDEN')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A negotiable service has no list price; a priced service must have one.
  CHECK ((price_type = 'NEGOTIABLE') = (base_price IS NULL))
);
CREATE INDEX IF NOT EXISTS expert_service_visible
  ON kg_membership.expert_services(visibility, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS expert_service_owner
  ON kg_membership.expert_services(expert_member_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS expert_service_category
  ON kg_membership.expert_services(category, visibility, created_at DESC, id DESC);

GRANT SELECT, INSERT, UPDATE ON kg_membership.expert_profiles, kg_membership.expert_services TO kg_dev_runtime;

COMMIT;
