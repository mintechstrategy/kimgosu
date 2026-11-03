-- KG-PARALLEL-10-WS-24: quote amount / VAT / validity-period policy.
--
-- User-confirmed rules implemented here:
--   * VAT is quoted SEPARATELY by default ("부가세 별도"). `vat_included`
--     records whether the presented amount already contains VAT.
--   * Hourly vs total pricing must be distinguishable -> `price_type`
--     ('HOURLY' | 'TOTAL') plus a nullable `hourly_rate` for HOURLY quotes.
--   * Quote validity: default 7 days, hard maximum 30 days. The server computes
--     and validates expires_at; the column itself only carries the result.
--
-- Additive and re-runnable: existing rows keep their amount and are backfilled
-- to price_type='TOTAL', vat_included=false (no amount/value is changed).
--
-- CANDIDATE ONLY -- this work unit applies it to a throwaway local test
-- cluster only. No Railway / dev database is touched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.quotes
  ADD COLUMN IF NOT EXISTS price_type   text    NOT NULL DEFAULT 'TOTAL',
  ADD COLUMN IF NOT EXISTS vat_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hourly_rate  integer;

-- Backfill: `ADD COLUMN ... NOT NULL DEFAULT` rewrites every existing row with
-- the default, so pre-existing quotes become price_type='TOTAL',
-- vat_included=false, hourly_rate=NULL. No amount is recomputed and no row is
-- rewritten again on a second run (there is deliberately no UPDATE here: an
-- UPDATE would silently re-label HOURLY quotes created after this migration).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_price_type_valid'
       AND conrelid = 'kg_membership.quotes'::regclass
  ) THEN
    ALTER TABLE kg_membership.quotes
      ADD CONSTRAINT quote_price_type_valid
      CHECK (price_type IN ('HOURLY','TOTAL'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_hourly_rate_required'
       AND conrelid = 'kg_membership.quotes'::regclass
  ) THEN
    -- A HOURLY quote without a rate cannot be understood by either side, and a
    -- TOTAL quote must not carry a stray rate.
    ALTER TABLE kg_membership.quotes
      ADD CONSTRAINT quote_hourly_rate_required
      CHECK ((price_type = 'HOURLY') = (hourly_rate IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_hourly_rate_positive'
       AND conrelid = 'kg_membership.quotes'::regclass
  ) THEN
    ALTER TABLE kg_membership.quotes
      ADD CONSTRAINT quote_hourly_rate_positive
      CHECK (hourly_rate IS NULL OR (hourly_rate > 0 AND hourly_rate <= 2147483647));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'quote_ttl_max_30_days'
       AND conrelid = 'kg_membership.quotes'::regclass
  ) THEN
    -- Defence in depth for the server-side 7/30-day rule: no row may claim a
    -- validity window longer than 30 days, whatever wrote it. NOT VALID because
    -- rows created under the previous "any future expiry" rule may legitimately
    -- exceed it; the constraint is enforced for every new insert/update without
    -- rewriting or rejecting existing history.
    ALTER TABLE kg_membership.quotes
      ADD CONSTRAINT quote_ttl_max_30_days
      CHECK (expires_at <= created_at + interval '30 days') NOT VALID;
  END IF;
END $$;

COMMIT;
-- Rollback: ALTER TABLE kg_membership.quotes
--   DROP CONSTRAINT quote_ttl_max_30_days, DROP CONSTRAINT quote_hourly_rate_positive,
--   DROP CONSTRAINT quote_hourly_rate_required, DROP CONSTRAINT quote_price_type_valid,
--   DROP COLUMN price_type, DROP COLUMN vat_included, DROP COLUMN hourly_rate;
-- Rollback discards only the new columns/constraints (no row deletion). Rows that
-- were created as HOURLY would lose their rate, so roll back before production
-- use, not after hourly quotes exist.
