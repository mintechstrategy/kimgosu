-- Ledger cancellation (PLAN-WAVE10 / WS-71).
--
-- A ledger used to be a one-way container: open it and the only exit was
-- COMPLETED. This adds a bilateral cancellation on the ledger itself:
--
--   ACTIVE --(one party requests)--> CANCEL_REQUESTED --(counterpart accepts)--> CANCELLED
--
-- Decisions applied:
--   * The cancellation belongs to the ledger, not to a single agreement: the
--     ledger is the trade, so one "거래 취소" covers its quotes and agreements.
--   * Two-party consent: a party can only *request*; the counterpart accepts.
--     The server decides which branch a call takes, never the client.
--   * 완료된 거래(cancelled_at 이후 / agreements.status='COMPLETED')는 취소 불가.
--     That rule lives in the API because it needs a look at agreements.
--
-- Additive only. No existing column is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.ledgers
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS cancel_requested_by  uuid REFERENCES kg_membership.members(id),
  ADD COLUMN IF NOT EXISTS cancel_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason_code   text,
  ADD COLUMN IF NOT EXISTS cancel_reason_detail text,
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz;

ALTER TABLE kg_membership.ledgers DROP CONSTRAINT IF EXISTS ledger_status_valid;
ALTER TABLE kg_membership.ledgers
  ADD CONSTRAINT ledger_status_valid CHECK (status IN ('ACTIVE','CANCEL_REQUESTED','CANCELLED'));

ALTER TABLE kg_membership.ledgers DROP CONSTRAINT IF EXISTS ledger_cancel_request_complete;
ALTER TABLE kg_membership.ledgers
  ADD CONSTRAINT ledger_cancel_request_complete CHECK (
    status = 'ACTIVE'
    OR (cancel_requested_by IS NOT NULL AND cancel_requested_at IS NOT NULL AND cancel_reason_code IS NOT NULL)
  );

-- A cancelled ledger and its timestamp can never disagree.
ALTER TABLE kg_membership.ledgers DROP CONSTRAINT IF EXISTS ledger_cancelled_stamped;
ALTER TABLE kg_membership.ledgers
  ADD CONSTRAINT ledger_cancelled_stamped CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

ALTER TABLE kg_membership.ledgers DROP CONSTRAINT IF EXISTS ledger_cancel_reason_length;
ALTER TABLE kg_membership.ledgers
  ADD CONSTRAINT ledger_cancel_reason_length CHECK (
    cancel_reason_detail IS NULL OR length(cancel_reason_detail) BETWEEN 1 AND 500
  );

COMMIT;
