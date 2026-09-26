"""Add service-independent chat subjects, rooms, participants, and messages."""

from alembic import op

revision = "0002_chat"
down_revision = "0001_bootstrap"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE chat_subjects (
            id uuid PRIMARY KEY,
            subject_type varchar(80) NOT NULL,
            subject_id uuid NOT NULL,
            owner_user_id uuid NOT NULL,
            active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_chat_subject UNIQUE (subject_type, subject_id),
            CONSTRAINT ck_chat_subject_type CHECK (subject_type ~ '^[a-z][a-z0-9_]{1,79}$')
        );
        CREATE TABLE chat_rooms (
            id uuid PRIMARY KEY,
            subject_id uuid NOT NULL REFERENCES chat_subjects(id) ON DELETE RESTRICT,
            initiated_by uuid NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_message_at timestamptz,
            CONSTRAINT uq_chat_room_subject_initiator UNIQUE (subject_id, initiated_by)
        );
        CREATE INDEX ix_chat_rooms_last_message ON chat_rooms (last_message_at DESC NULLS LAST, created_at DESC);
        CREATE TABLE chat_participants (
            room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
            user_id uuid NOT NULL,
            joined_at timestamptz NOT NULL DEFAULT now(),
            last_read_message_id uuid,
            PRIMARY KEY (room_id, user_id)
        );
        CREATE INDEX ix_chat_participants_user ON chat_participants (user_id, room_id);
        CREATE TABLE chat_messages (
            id uuid PRIMARY KEY,
            room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
            sender_user_id uuid NOT NULL,
            client_message_id uuid NOT NULL,
            body text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_chat_message_client UNIQUE (room_id, sender_user_id, client_message_id),
            CONSTRAINT ck_chat_message_body CHECK (char_length(body) BETWEEN 1 AND 4000),
            CONSTRAINT fk_chat_message_sender FOREIGN KEY (room_id, sender_user_id)
                REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT
        );
        CREATE INDEX ix_chat_messages_room_cursor ON chat_messages (room_id, created_at DESC, id DESC);
        ALTER TABLE chat_participants ADD CONSTRAINT fk_chat_participants_read_message
            FOREIGN KEY (last_read_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
    """)


def downgrade():
    op.execute("DROP TABLE chat_messages CASCADE")
    op.execute("DROP TABLE chat_participants CASCADE")
    op.execute("DROP TABLE chat_rooms CASCADE")
    op.execute("DROP TABLE chat_subjects CASCADE")
