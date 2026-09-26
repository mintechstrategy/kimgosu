"""Attach private files to messages and permit attachment-only messages."""

from alembic import op

revision = "0003_chat_attachments"
down_revision = "0002_chat"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE chat_messages DROP CONSTRAINT ck_chat_message_body")
    op.execute("ALTER TABLE chat_messages ADD CONSTRAINT ck_chat_message_body CHECK (char_length(body) <= 4000)")
    op.execute("""
        CREATE TABLE chat_attachments (
            id uuid PRIMARY KEY,
            room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
            uploader_user_id uuid NOT NULL,
            message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
            filename varchar(255) NOT NULL,
            content_type varchar(255) NOT NULL,
            byte_size bigint NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_chat_attachment_size CHECK (byte_size BETWEEN 1 AND 104857600),
            CONSTRAINT fk_chat_attachment_uploader FOREIGN KEY (room_id, uploader_user_id)
                REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT
        )
    """)
    op.execute("CREATE INDEX ix_chat_attachments_message ON chat_attachments (message_id)")


def downgrade():
    op.execute("DROP TABLE chat_attachments")
    op.execute("ALTER TABLE chat_messages DROP CONSTRAINT ck_chat_message_body")
    op.execute("ALTER TABLE chat_messages ADD CONSTRAINT ck_chat_message_body CHECK (char_length(body) BETWEEN 1 AND 4000)")
