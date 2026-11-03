-- Customer ledger (고객원장), bilateral agreements, and role grants.
--
-- Decisions applied (user-confirmed 2026-11-03):
--   * Ledger unit      : one ledger per (expert, customer-member). A member is a
--                        single social identity, so the same person signing up
--                        through a different provider is a different customer.
--   * Agreement        : bilateral — request -> accept -> complete. A completed
--                        agreement is the only review eligibility basis.
--   * Roles            : USER < EXPERT < CS < ADMIN. EXPERT is the existing
--                        members.expert_active flag (immediate activation).
--                        CS/ADMIN require an explicit grant with reason, period
--                        and a recorded revoker.
--   * Withdrawal       : trade records follow the 1-year retention already on
--                        members; private ledger notes are purged immediately.
--
-- Additive only. No existing table is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

-- ── Customer ledger ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kg_membership.ledgers (
  id                 uuid PRIMARY KEY,
  expert_member_id   uuid NOT NULL REFERENCES kg_membership.members(id),
  customer_member_id uuid NOT NULL REFERENCES kg_membership.members(id),
  display_name       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (expert_member_id <> customer_member_id),
  UNIQUE (expert_member_id, customer_member_id)
);
CREATE INDEX IF NOT EXISTS ledger_owner ON kg_membership.ledgers(expert_member_id, updated_at DESC);

-- Private notes. Deleted immediately when either party withdraws.
CREATE TABLE IF NOT EXISTS kg_membership.ledger_notes (
  id            uuid PRIMARY KEY,
  ledger_id     uuid NOT NULL REFERENCES kg_membership.ledgers(id) ON DELETE CASCADE,
  author_member_id uuid NOT NULL REFERENCES kg_membership.members(id),
  body          text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  purged_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ledger_note_list ON kg_membership.ledger_notes(ledger_id, created_at DESC);

-- ── Bilateral agreement ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kg_membership.agreements (
  id                    uuid PRIMARY KEY,
  ledger_id             uuid NOT NULL REFERENCES kg_membership.ledgers(id) ON DELETE CASCADE,
  requester_member_id   uuid NOT NULL REFERENCES kg_membership.members(id),
  counterpart_member_id uuid NOT NULL REFERENCES kg_membership.members(id),
  summary               text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 500),
  status                text NOT NULL DEFAULT 'REQUESTED'
                          CHECK (status IN ('REQUESTED','ACCEPTED','COMPLETED','CANCELLED','DISPUTED')),
  version               bigint NOT NULL DEFAULT 1,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at           timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  CHECK (requester_member_id <> counterpart_member_id),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agreement_pair ON kg_membership.agreements(ledger_id, status);

-- ── Roles ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kg_membership.roles (
  id          text PRIMARY KEY CHECK (id IN ('USER','EXPERT','CS','ADMIN')),
  label       text NOT NULL,
  description text NOT NULL
);
INSERT INTO kg_membership.roles(id,label,description) VALUES
  ('USER','일반 이용자','서비스 탐색·요청·상담'),
  ('EXPERT','고수','자신의 서비스·포트폴리오 게시와 견적 제안'),
  ('CS','고객센터','배정된 CS 건의 제한 열람·처리'),
  ('ADMIN','관리자','계정·콘텐츠·지역·분류 운영')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS kg_membership.role_grants (
  id                uuid PRIMARY KEY,
  member_id         uuid NOT NULL REFERENCES kg_membership.members(id),
  role_id           text NOT NULL REFERENCES kg_membership.roles(id),
  granted_by        uuid REFERENCES kg_membership.members(id),
  reason            text NOT NULL CHECK (length(trim(reason)) BETWEEN 2 AND 500),
  starts_at         timestamptz NOT NULL DEFAULT now(),
  ends_at           timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid REFERENCES kg_membership.members(id),
  revoke_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS role_grant_live ON kg_membership.role_grants(member_id, role_id)
  WHERE revoked_at IS NULL;

-- ── Audit ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kg_membership.audit_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_member_id  uuid REFERENCES kg_membership.members(id),
  action           text NOT NULL,
  target_type      text NOT NULL,
  target_id        text NOT NULL,
  reason           text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_recent ON kg_membership.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_target ON kg_membership.audit_log(target_type, target_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON kg_membership.ledgers, kg_membership.ledger_notes,
  kg_membership.agreements, kg_membership.role_grants TO kg_dev_runtime;
GRANT SELECT ON kg_membership.roles TO kg_dev_runtime;
GRANT SELECT, INSERT ON kg_membership.audit_log TO kg_dev_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kg_membership TO kg_dev_runtime;

COMMIT;
