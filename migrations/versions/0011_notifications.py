"""Account-scoped inbox for marketplace and chat events."""

from alembic import op

revision = "0011_notifications"
down_revision = "0010_support_tickets"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE notifications (
            id uuid PRIMARY KEY,
            recipient_user_id varchar(80) NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
            actor_user_id varchar(80) NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
            event_type varchar(40) NOT NULL CHECK (event_type IN
                ('chat.message', 'proposal.created', 'review.created', 'service.inquiry')),
            source_id uuid NOT NULL,
            room_id uuid REFERENCES chat_rooms(id) ON DELETE RESTRICT,
            title varchar(160) NOT NULL,
            body varchar(300) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            read_at timestamptz,
            CHECK (recipient_user_id <> actor_user_id),
            UNIQUE (recipient_user_id, event_type, source_id)
        );
        CREATE INDEX ix_notifications_recipient_created
            ON notifications(recipient_user_id, created_at DESC, id DESC);
        CREATE INDEX ix_notifications_unread
            ON notifications(recipient_user_id, created_at DESC) WHERE read_at IS NULL;
    """)


def downgrade():
    op.execute("DROP TABLE notifications")
