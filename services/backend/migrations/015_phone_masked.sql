-- WS-28 phone masking (migration number fixed by PLAN-WAVE3).
--
-- User-confirmed rule: only a masked phone value is ever stored. The full number
-- is never persisted anywhere — members.phone_digest (002) remains the lookup
-- and uniqueness key, and the raw input is discarded after the MAC is computed.
--
-- Storage path: `POST /v1/auth/sms/send` is the point where a raw phone number
-- is received. It writes the masked form onto the registration ticket; signup
-- copies that same masked value onto the member row. `registration_tickets`
-- therefore gets the column too, so the masked value survives the gap between
-- verification and signup without re-introducing a raw number.
--
-- Format: `010-****-1234` only (CHECK). Anything else — a raw number, a partial
-- mask, a foreign prefix — is rejected by the database, not just by the API.
--
-- Existing rows keep NULL: a masked value is not derivable from a digest, so
-- back-filling would be guessing.
--
-- Additive only. No column is dropped or rewritten; no data is changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.members ADD COLUMN IF NOT EXISTS phone_masked text;
ALTER TABLE kg_membership.registration_tickets ADD COLUMN IF NOT EXISTS phone_masked text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'members_phone_masked_format'
       AND conrelid = 'kg_membership.members'::regclass
  ) THEN
    ALTER TABLE kg_membership.members
      ADD CONSTRAINT members_phone_masked_format
      CHECK (phone_masked IS NULL OR phone_masked ~ '^010-\*{4}-[0-9]{4}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'registration_tickets_phone_masked_format'
       AND conrelid = 'kg_membership.registration_tickets'::regclass
  ) THEN
    ALTER TABLE kg_membership.registration_tickets
      ADD CONSTRAINT registration_tickets_phone_masked_format
      CHECK (phone_masked IS NULL OR phone_masked ~ '^010-\*{4}-[0-9]{4}$');
  END IF;
END
$$;

-- kg_dev_runtime already holds UPDATE on both tables (001/002). No new grant.

COMMIT;
