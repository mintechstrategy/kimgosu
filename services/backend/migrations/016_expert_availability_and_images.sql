-- Expert availability and service images.
--
-- Scope (사용자 확정 2026-11-03):
--   * 수신 중 / 일시중지 / 휴가 세 가지 활동 상태. The existing
--     expert_profiles.status is the operator-controlled visibility (ACTIVE or
--     HIDDEN); availability is what the expert toggles day to day, so the two
--     stay separate.
--   * Service images. The image itself lives in R2; only the object key is
--     stored here, and the public URL is composed at read time so the bucket
--     domain can change without a migration.
--
-- Additive only. No existing column is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.expert_profiles
  ADD COLUMN IF NOT EXISTS availability text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (availability IN ('AVAILABLE','PAUSED','VACATION'));

ALTER TABLE kg_membership.expert_services
  ADD COLUMN IF NOT EXISTS image_key text
    CHECK (image_key IS NULL OR length(image_key) BETWEEN 1 AND 300);

COMMIT;
