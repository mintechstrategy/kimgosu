-- KG-PARALLEL-10-WS-26: review window + moderation reason.
-- Migration number fixed by tasks/parallel-10/PLAN-WAVE3.md.
--
-- Decisions applied (user-confirmed 2026-11-03):
--   * Window  : a review may be written until the agreeing agreement's
--               completed_at + 30 days. Closed window -> 403 REVIEW_WINDOW_CLOSED.
--               The server decides from `agreements.completed_at`; no client flag,
--               no column is added for the deadline.
--   * Body    : optional, 1..2000 characters (already enforced by 011).
--   * Public  : only the author's nickname is exposed by the public list.
--   * Hiding  : operator-only. `hidden_at` marks the row, `hidden_reason` keeps
--               why. Hiding is not deletion: the row and its audit trail stay.
--
-- Additive only: one nullable column plus a state consistency constraint.
-- No existing column, row or index is rewritten or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.reviews ADD COLUMN IF NOT EXISTS hidden_reason text;

COMMENT ON COLUMN kg_membership.reviews.hidden_reason IS
  'operator-provided reason recorded together with hidden_at (WS-26). NULL when the row is visible.';

-- A reason may never outlive the hide it explains. The inverse is deliberately
-- allowed: rows hidden before 014 (or by a data fix) keep hidden_at without a
-- reason, and 011's existing data must stay valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'review_hidden_reason_requires_hidden'
       AND conrelid = 'kg_membership.reviews'::regclass
  ) THEN
    ALTER TABLE kg_membership.reviews
      ADD CONSTRAINT review_hidden_reason_requires_hidden
      CHECK (hidden_reason IS NULL OR hidden_at IS NOT NULL);
  END IF;
END $$;

COMMIT;
