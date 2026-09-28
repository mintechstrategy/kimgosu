"""Store a service-independent display title on each chat subject."""

from alembic import op

revision = "0009_chat_subject_title"
down_revision = "0008_completion_reviews"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE chat_subjects ADD COLUMN display_title varchar(120)")
    # One-time data migration for the two existing subject providers. Runtime chat
    # queries still depend only on chat tables, so future domains need no chat change.
    op.execute("""
        UPDATE chat_subjects cs SET display_title = s.title
        FROM services s WHERE cs.subject_type='service' AND cs.subject_id=s.id
    """)
    op.execute("""
        UPDATE chat_subjects cs SET display_title = q.title
        FROM quote_requests q
        WHERE cs.subject_type='quote_request' AND cs.subject_id=q.id
    """)


def downgrade():
    op.execute("ALTER TABLE chat_subjects DROP COLUMN display_title")
