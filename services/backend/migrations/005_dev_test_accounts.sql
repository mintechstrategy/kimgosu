-- Development-only test accounts for the temporary login screen.
-- Social login is not connected yet, so testers need a server-issued session
-- without going through an OAuth provider.
--
-- This table must stay empty in production. The API only exposes the endpoints
-- when KG_DEV_LOGIN=1 AND the Railway environment name is exactly 'dev'.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.dev_test_accounts (
  slot        integer PRIMARY KEY CHECK (slot BETWEEN 1 AND 20),
  role        text NOT NULL CHECK (role IN ('USER','EXPERT')),
  label       text NOT NULL CHECK (length(trim(label)) > 0),
  member_id   uuid NOT NULL REFERENCES kg_membership.members(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id)
);

-- 10 regular users (1-10) and 10 expert-mode users (11-20).
CREATE UNIQUE INDEX IF NOT EXISTS dev_test_accounts_role_slot
  ON kg_membership.dev_test_accounts(role, slot);

GRANT SELECT ON kg_membership.dev_test_accounts TO kg_dev_runtime;

COMMIT;
