-- KG-AUTH-BACKEND-01: additive explicit social ownership-link binding + age acknowledgement audit.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
ALTER TABLE kg_membership.oauth_flows ADD COLUMN IF NOT EXISTS link_member_id uuid REFERENCES kg_membership.members(id);
ALTER TABLE kg_membership.members ADD COLUMN IF NOT EXISTS age14_confirmed_at timestamptz;
COMMIT;
-- Roll application back without dropping columns or changing existing member history.
