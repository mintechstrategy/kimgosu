-- Reviews for completed trades (WS-16, migration number fixed by PLAN-WAVE2).
--
-- Decisions applied (user-confirmed 2026-11-03, option b):
--   * Eligibility : the reviewer must be a participant of the ledger AND a
--                   COMPLETED agreement must exist for that same ledger.
--                   A self-reported "trade finished" flag is not a basis.
--   * Identity    : (ledger_id, author_id) is unique — one review per author
--                   per ledger. A customer and an expert may each review the
--                   other once.
--   * Target      : the counterpart of the ledger, never the author.
--   * Rating      : integer 1..5.
--   * Aggregates  : computed at read time (AVG over visible rows). No summary
--                   table is created on purpose.
--   * Hiding      : hidden_at is a moderation marker; hidden rows are excluded
--                   from reads and aggregates but kept for audit.
--
-- Additive only. No existing table is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.reviews (
  id         uuid PRIMARY KEY,
  ledger_id  uuid NOT NULL REFERENCES kg_membership.ledgers(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES kg_membership.members(id),
  target_id  uuid NOT NULL REFERENCES kg_membership.members(id),
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at  timestamptz,
  CHECK (author_id <> target_id),
  UNIQUE (ledger_id, author_id)
);
CREATE INDEX IF NOT EXISTS review_target_visible
  ON kg_membership.reviews(target_id, created_at DESC, id DESC)
  WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS review_author
  ON kg_membership.reviews(author_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON kg_membership.reviews TO kg_dev_runtime;

COMMIT;
