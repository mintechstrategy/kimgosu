-- Image-only chat messages were rejected by the older body shape rule.
--
-- 018 added `chat_messages_body_check`, which allows an empty body when the row
-- carries an image, but it did not remove `chat_message_body_shape`. That older
-- rule demands `body IS NULL` or a non-empty body, so an image message with an
-- empty string body failed the table CHECK and the API answered 500.
--
-- The new rule already covers the cases the old one guarded (empty rows are
-- refused, over-long rows are refused), so the old rule is dropped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE kg_membership.chat_messages
  DROP CONSTRAINT IF EXISTS chat_message_body_shape;

COMMIT;
