-- KG-PARALLEL-10-WS-02: read-path indexes for policy version history and
-- consent-withdrawal history. CANDIDATE ONLY -- not applied to any Railway or
-- dev database by this work unit. Additive: no column/type/constraint change,
-- no data rewrite, no table rewrite, no privilege change.
--
-- Each index below is tied to a statement that exists in this repository:
--   * src/policy.ts policySnapshotSelect / currentDocumentsSelect  (kind,
--     effective_at DESC, id DESC) with status='READY' AND approved_at IS NOT NULL
--   * src/policy.ts policySnapshotSelect document list ordering
--     (kind, created_at DESC, id DESC)  -- policy version history
--   * src/app.ts GET /v1/me/consents      (member_id) then id DESC
--   * src/app.ts PATCH /v1/me/notifications MARKETING lookup (member_id) latest
--   * withdrawal history: (member_id) WHERE action='WITHDRAWN' newest first
--
-- Deliberately NOT indexed: the display selector in policySnapshotSelect orders
-- by (status='READY' AND approved_at IS NOT NULL AND effective_at<=now()) first.
-- now() makes that expression non-IMMUTABLE, so PostgreSQL cannot index it and no
-- index can remove that sort. Documented in RUNNER-NOTES.md instead of pretending
-- otherwise.
--
-- Locking: CREATE INDEX (non-concurrent) takes SHARE on the table and blocks
-- writers for the build. Acceptable for the current table sizes; on a large
-- production table build these as CREATE INDEX CONCURRENTLY outside a
-- transaction and outside business hours. See RUNNER-NOTES.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Current-document resolution: DISTINCT ON(kind) ... ORDER BY kind,effective_at DESC,id DESC
CREATE INDEX IF NOT EXISTS policy_current_effective
  ON kg_membership.policy_documents (kind, effective_at DESC, id DESC)
  WHERE status = 'READY' AND approved_at IS NOT NULL;

-- Policy version history: every version of a kind, newest first.
CREATE INDEX IF NOT EXISTS policy_kind_version_history
  ON kg_membership.policy_documents (kind, created_at DESC, id DESC);

-- Latest-consent lookup per member (GET /v1/me/consents, MARKETING gate).
CREATE INDEX IF NOT EXISTS consent_member_recent
  ON kg_membership.consent_events (member_id, id DESC);

-- Withdrawal history per member, newest first.
CREATE INDEX IF NOT EXISTS consent_withdrawal_history
  ON kg_membership.consent_events (member_id, recorded_at DESC, id DESC)
  WHERE action = 'WITHDRAWN';

COMMIT;
-- Rollback: DROP INDEX CONCURRENTLY kg_membership.<name> for the four indexes.
-- Indexes hold no data of their own; dropping them is lossless and never
-- requires touching policy_documents or consent_events rows.
