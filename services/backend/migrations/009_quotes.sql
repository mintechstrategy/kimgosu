-- KG-PARALLEL-10-WS-14: quote -> acceptance -> bilateral completion flow.
--
-- Extends wave 1's single bilateral agreement (006_ledger_and_permissions.sql)
-- into a real quote flow:
--
--   PROPOSED --(customer accept)--> ACCEPTED --(both parties confirm)--> COMPLETED
--            --(customer reject)--> REJECTED
--            --(expires_at passed)--> EXPIRED
--
-- User-confirmed rules applied here:
--   * Completion requires BOTH sides to confirm ("양측확인"). One confirmation
--     leaves the quote in ACCEPTED with a recorded confirmation timestamp.
--   * State transitions are decided by the server. Clients never supply status,
--     amount or completion flags; those columns are written only by the API.
--   * An accepted quote materialises the wave-1 agreement row (status ACCEPTED)
--     so review eligibility keeps a single basis (agreements COMPLETED).
--
-- CANDIDATE ONLY -- not applied to any Railway or dev database by this work
-- unit. Additive: no existing table/column is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.quotes (
  id                     uuid PRIMARY KEY,
  ledger_id              uuid NOT NULL REFERENCES kg_membership.ledgers(id) ON DELETE CASCADE,
  expert_member_id       uuid NOT NULL REFERENCES kg_membership.members(id),
  customer_member_id     uuid NOT NULL REFERENCES kg_membership.members(id),
  -- KRW integer amount. Currency/VAT policy is not yet confirmed -> OPEN item
  -- in the work-unit RESULT, not silently assumed by the schema.
  amount                 integer NOT NULL CHECK (amount > 0),
  schedule_at            timestamptz,
  message                text NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
  status                 text NOT NULL DEFAULT 'PROPOSED'
                           CHECK (status IN ('PROPOSED','ACCEPTED','REJECTED','EXPIRED','COMPLETED','CANCELLED')),
  version                bigint NOT NULL DEFAULT 1,
  expires_at             timestamptz NOT NULL,
  agreement_id           uuid REFERENCES kg_membership.agreements(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  accepted_at            timestamptz,
  rejected_at            timestamptz,
  customer_confirmed_at  timestamptz,
  expert_confirmed_at    timestamptz,
  completed_at           timestamptz,
  CHECK (expert_member_id <> customer_member_id),
  CHECK (expires_at > created_at),
  CHECK ((status IN ('ACCEPTED','COMPLETED')) = (accepted_at IS NOT NULL)),
  CHECK ((status = 'REJECTED') = (rejected_at IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR (customer_confirmed_at IS NOT NULL AND expert_confirmed_at IS NOT NULL)),
  CHECK ((status IN ('ACCEPTED','COMPLETED')) = (agreement_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS quote_ledger_recent ON kg_membership.quotes(ledger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quote_customer_status ON kg_membership.quotes(customer_member_id, status, created_at DESC);

-- Every state change, in order. Kept as its own append-only table so the flow
-- can be reconstructed without relying on audit_log retention.
CREATE TABLE IF NOT EXISTS kg_membership.quote_transitions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id        uuid NOT NULL REFERENCES kg_membership.quotes(id) ON DELETE CASCADE,
  from_status     text,
  to_status       text NOT NULL,
  actor_member_id uuid REFERENCES kg_membership.members(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_transition_history ON kg_membership.quote_transitions(quote_id, id);

GRANT SELECT, INSERT, UPDATE ON kg_membership.quotes TO kg_dev_runtime;
GRANT SELECT, INSERT ON kg_membership.quote_transitions TO kg_dev_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA kg_membership TO kg_dev_runtime;

COMMIT;
-- Rollback: DROP TABLE kg_membership.quote_transitions, kg_membership.quotes.
-- Both tables hold only new data; no existing table or row is touched.
