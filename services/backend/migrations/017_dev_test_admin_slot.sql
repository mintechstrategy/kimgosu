-- The operator console needs a dev tester account too.
--
-- 005 capped the slots at 20 and the roles at USER|EXPERT, which was enough
-- while the console had no login. An operator now signs in with a real member
-- session and exchanges it for an admin session, so the dev tester list needs an
-- ADMIN row. Widening the two checks is additive; existing rows still satisfy
-- them.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.dev_test_accounts
  DROP CONSTRAINT IF EXISTS dev_test_accounts_slot_check,
  DROP CONSTRAINT IF EXISTS dev_test_accounts_role_check;

ALTER TABLE kg_membership.dev_test_accounts
  ADD CONSTRAINT dev_test_accounts_slot_check CHECK (slot BETWEEN 1 AND 30),
  ADD CONSTRAINT dev_test_accounts_role_check CHECK (role IN ('USER', 'EXPERT', 'ADMIN'));

COMMIT;
