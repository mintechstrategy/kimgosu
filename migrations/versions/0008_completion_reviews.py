"""Bilateral completion and reviews for any chat subject type."""

from alembic import op

revision = "0008_completion_reviews"
down_revision = "0007_marketplace"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE chat_completion_confirmations (
            room_id uuid NOT NULL,
            user_id varchar(80) NOT NULL,
            confirmed_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (room_id, user_id),
            FOREIGN KEY (room_id, user_id)
                REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT
        );
        CREATE TABLE reviews (
            id uuid PRIMARY KEY,
            room_id uuid NOT NULL REFERENCES chat_rooms(id) ON DELETE RESTRICT,
            reviewer_user_id varchar(80) NOT NULL,
            target_user_id varchar(80) NOT NULL,
            rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
            body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 10 AND 1000),
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (room_id, reviewer_user_id),
            CHECK (reviewer_user_id <> target_user_id),
            FOREIGN KEY (room_id, reviewer_user_id)
                REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT,
            FOREIGN KEY (room_id, target_user_id)
                REFERENCES chat_participants(room_id, user_id) ON DELETE RESTRICT
        );
        CREATE INDEX ix_reviews_target_created ON reviews(target_user_id, created_at DESC);
        ALTER TABLE services DROP CONSTRAINT services_status_check;
        ALTER TABLE services ADD CONSTRAINT services_status_check
            CHECK (status IN ('active', 'hidden', 'deleted'));
        ALTER TABLE quote_requests DROP CONSTRAINT quote_requests_status_check;
        ALTER TABLE quote_requests ADD CONSTRAINT quote_requests_status_check
            CHECK (status IN ('open', 'closed', 'deleted'));
    """)


def downgrade():
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM services WHERE status='deleted') OR
             EXISTS (SELECT 1 FROM quote_requests WHERE status='deleted') THEN
            RAISE EXCEPTION 'Cannot downgrade while deleted resources exist';
          END IF;
        END $$;
        ALTER TABLE services DROP CONSTRAINT services_status_check;
        ALTER TABLE services ADD CONSTRAINT services_status_check
            CHECK (status IN ('active', 'hidden'));
        ALTER TABLE quote_requests DROP CONSTRAINT quote_requests_status_check;
        ALTER TABLE quote_requests ADD CONSTRAINT quote_requests_status_check
            CHECK (status IN ('open', 'closed'));
        DROP TABLE reviews;
        DROP TABLE chat_completion_confirmations;
    """)
