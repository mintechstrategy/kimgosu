"""Customer ledger keyed by prefixed user ID; align chat identity columns."""

from alembic import op

revision = "0004_customer_identity"
down_revision = "0003_chat_attachments"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE customers (
            user_id varchar(80) PRIMARY KEY,
            ci_lookup_hash char(64) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_customer_user_id CHECK (user_id ~ '^[a-z][a-z0-9]*_[0-9a-f]{32}$'),
            CONSTRAINT ck_customer_ci_hash CHECK (ci_lookup_hash ~ '^[0-9a-f]{64}$')
        );
        CREATE UNIQUE INDEX uq_customers_ci_lookup_hash ON customers (ci_lookup_hash);

        ALTER TABLE chat_messages DROP CONSTRAINT fk_chat_message_sender;
        ALTER TABLE chat_attachments DROP CONSTRAINT fk_chat_attachment_uploader;
        ALTER TABLE chat_subjects ALTER COLUMN owner_user_id TYPE varchar(80) USING owner_user_id::text;
        ALTER TABLE chat_rooms ALTER COLUMN initiated_by TYPE varchar(80) USING initiated_by::text;
        ALTER TABLE chat_participants ALTER COLUMN user_id TYPE varchar(80) USING user_id::text;
        ALTER TABLE chat_messages ALTER COLUMN sender_user_id TYPE varchar(80) USING sender_user_id::text;
        ALTER TABLE chat_attachments ALTER COLUMN uploader_user_id TYPE varchar(80) USING uploader_user_id::text;
        ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_message_sender
            FOREIGN KEY (room_id, sender_user_id)
            REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT;
        ALTER TABLE chat_attachments ADD CONSTRAINT fk_chat_attachment_uploader
            FOREIGN KEY (room_id, uploader_user_id)
            REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT;
    """)


def downgrade():
    # The casts intentionally fail if prefixed IDs have been used in chat: there is
    # no lossless conversion back to UUID. Keep the previous schema and data intact.
    op.execute("""
        ALTER TABLE chat_messages DROP CONSTRAINT fk_chat_message_sender;
        ALTER TABLE chat_attachments DROP CONSTRAINT fk_chat_attachment_uploader;
        ALTER TABLE chat_subjects ALTER COLUMN owner_user_id TYPE uuid USING owner_user_id::uuid;
        ALTER TABLE chat_rooms ALTER COLUMN initiated_by TYPE uuid USING initiated_by::uuid;
        ALTER TABLE chat_participants ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
        ALTER TABLE chat_messages ALTER COLUMN sender_user_id TYPE uuid USING sender_user_id::uuid;
        ALTER TABLE chat_attachments ALTER COLUMN uploader_user_id TYPE uuid USING uploader_user_id::uuid;
        ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_message_sender
            FOREIGN KEY (room_id, sender_user_id)
            REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT;
        ALTER TABLE chat_attachments ADD CONSTRAINT fk_chat_attachment_uploader
            FOREIGN KEY (room_id, uploader_user_id)
            REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT;
        DROP TABLE customers;
    """)
