-- In-app notification inbox (WS-75).
--
-- The row is what the inbox lists; nothing here sends push/APNs/FCM. Read state
-- lives on the row so the badge is derived from the server, never from client
-- bookkeeping.
--
-- Additive only: one new table, two indexes, one GRANT. No existing table is
-- altered or rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.notifications (
  id         uuid PRIMARY KEY,
  member_id  uuid NOT NULL REFERENCES kg_membership.members(id) ON DELETE CASCADE,
  -- The four inbox filters (견적/완료/후기/신고) map 1:1 to these kinds.
  kind       text NOT NULL CHECK (kind IN ('QUOTE', 'AGREEMENT', 'REVIEW', 'REPORT')),
  title      text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body       text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 500),
  -- The ledger the recipient can open. Null for rows not tied to a ledger.
  ledger_id  uuid REFERENCES kg_membership.ledgers(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);

CREATE INDEX IF NOT EXISTS notification_inbox
  ON kg_membership.notifications(member_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notification_unread
  ON kg_membership.notifications(member_id)
  WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON kg_membership.notifications TO kg_dev_runtime;

COMMIT;
