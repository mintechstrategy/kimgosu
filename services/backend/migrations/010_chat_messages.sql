-- KG-PARALLEL-10-WS-15: ledger chat messages (server-side storage + pagination).
--
-- Additive only: one new table, one index, one GRANT. No existing table is
-- altered, no data is rewritten, no privilege is widened beyond this table.
--
-- Scope note (deliberate, not an oversight):
--   * `deleted_at` exists as a column only. The deletion policy is NOT decided
--     (F5 conflict) and was left OPEN by the work unit. No endpoint sets, clears
--     or filters on it, and no default is written here.
--   * Delivery is store-and-read. Realtime (WebSocket/SSE) is out of scope for
--     this wave.
--
-- Ordering / pagination contract:
--   Messages are ordered by (created_at DESC, id DESC). `id` is the tiebreak so
--   that rows inserted in the same transaction (identical now()) still have a
--   total, stable order. The API cursor encodes that pair, so `before` paging
--   cannot duplicate or skip a row.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.chat_messages (
  id         uuid PRIMARY KEY,
  ledger_id  uuid NOT NULL REFERENCES kg_membership.ledgers(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES kg_membership.members(id),
  -- Same 1..2000 character rule as ledger_notes; the API rejects empty bodies
  -- with 400 before reaching this CHECK.
  body       text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  deleted_at timestamptz
);

-- Covers both the full listing and the `before` cursor predicate
-- (ledger_id = $1 AND (created_at, id) < ($2, $3)).
CREATE INDEX IF NOT EXISTS chat_message_page
  ON kg_membership.chat_messages(ledger_id, created_at DESC, id DESC);

GRANT SELECT, INSERT, UPDATE ON kg_membership.chat_messages TO kg_dev_runtime;

COMMIT;
