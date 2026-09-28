"""Private customer support requests from either app role."""

from alembic import op

revision = "0010_support_tickets"
down_revision = "0009_chat_subject_title"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE support_tickets (
            id uuid PRIMARY KEY,
            requester_user_id varchar(80) NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
            title varchar(120) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
            body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 4000),
            status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open')),
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_support_tickets_requester_created
            ON support_tickets(requester_user_id, created_at DESC, id DESC);
    """)


def downgrade():
    op.execute("DROP TABLE support_tickets")
