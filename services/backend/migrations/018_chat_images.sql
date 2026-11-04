-- KG-PARALLEL-10-WS-51: chat image attachments.
--
-- The image bytes stay in R2 (uploaded with a `POST /v1/uploads` presigned PUT);
-- only the object key and the decoded pixel size are stored. The public URL is
-- composed at read time, so the bucket domain can change without a migration.
--
-- Ownership: an image message may only reference a key under
-- `chat/<sender member id>/`. That check needs the session, so it lives in the
-- route (403 IMAGE_NOT_OWNED); this file only bounds the column.
--
-- Body rule: a text message keeps the 1..2000 character rule. An image message
-- may carry an empty body, so the CHECK is relaxed to "text OR image". Existing
-- rows all have a non-empty body and stay valid.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.chat_messages
  ADD COLUMN IF NOT EXISTS image_key text
    CHECK (image_key IS NULL OR length(image_key) BETWEEN 1 AND 300);

ALTER TABLE kg_membership.chat_messages
  ADD COLUMN IF NOT EXISTS image_width integer
    CHECK (image_width IS NULL OR image_width BETWEEN 1 AND 20000);

ALTER TABLE kg_membership.chat_messages
  ADD COLUMN IF NOT EXISTS image_height integer
    CHECK (image_height IS NULL OR image_height BETWEEN 1 AND 20000);

-- The original inline CHECK was created as chat_messages_body_check.
ALTER TABLE kg_membership.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_body_check;
ALTER TABLE kg_membership.chat_messages
  ADD CONSTRAINT chat_messages_body_check CHECK (
    length(trim(body)) BETWEEN 1 AND 2000
    OR (length(body) = 0 AND image_key IS NOT NULL)
  );

COMMIT;
