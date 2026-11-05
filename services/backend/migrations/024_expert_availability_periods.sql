-- Expert vacation periods (PLAN-WAVE10 / WS-73).
--
-- The three-state availability toggle (016) answers "right now"; it cannot say
-- "away from the 3rd to the 7th". A period is a day range owned by one expert,
-- and while today falls inside a period the expert is shown as 휴가 중 in the
-- public search results. Being away is a label, not a visibility change: the
-- expert stays listed.
--
-- Date granularity is deliberate. The product ask is 시작일/종료일, so both ends
-- are whole days and the end day is included. Timestamps would force a timezone
-- decision the product has not made.
--
-- Additive only. No existing table or column is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.expert_availability_periods (
  id         uuid PRIMARY KEY,
  member_id  uuid NOT NULL REFERENCES kg_membership.members(id) ON DELETE CASCADE,
  starts_at  date NOT NULL,
  ends_at    date NOT NULL,
  reason     text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expert_availability_periods_range CHECK (ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS expert_availability_periods_member
  ON kg_membership.expert_availability_periods(member_id, starts_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON kg_membership.expert_availability_periods TO kg_dev_runtime;

COMMIT;
