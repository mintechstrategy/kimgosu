-- Expert service portfolio images.
--
-- Scope (PLAN-WAVE7B / WS-54):
--   * One service may show up to five photos, in the order the expert chose.
--     The image_key column on expert_services stays as the representative
--     (cover) image so existing readers keep working; it always mirrors
--     sort_order 0 of this table.
--   * Only the R2 object key is stored. The public URL is composed at read
--     time, so the bucket domain can change without a migration.
--
-- Backfill copies any existing single image_key into sort_order 0 so that
-- imageKey and images[0] agree for rows written before this migration.
--
-- Additive only. No existing table or column is altered or dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

CREATE TABLE IF NOT EXISTS kg_membership.expert_service_images (
  id         uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES kg_membership.expert_services(id) ON DELETE CASCADE,
  image_key  text NOT NULL CHECK (length(image_key) BETWEEN 1 AND 300),
  sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, sort_order),
  UNIQUE (service_id, image_key)
);
CREATE INDEX IF NOT EXISTS expert_service_images_order
  ON kg_membership.expert_service_images(service_id, sort_order);

INSERT INTO kg_membership.expert_service_images(id, service_id, image_key, sort_order)
SELECT gen_random_uuid(), s.id, s.image_key, 0
  FROM kg_membership.expert_services s
 WHERE s.image_key IS NOT NULL
ON CONFLICT (service_id, sort_order) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON kg_membership.expert_service_images TO kg_dev_runtime;

COMMIT;
