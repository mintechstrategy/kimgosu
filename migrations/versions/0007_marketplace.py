"""Core service and quote flows for the Android MVP."""

from alembic import op

revision = "0007_marketplace"
down_revision = "0006_service_categories"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE services (
            id uuid PRIMARY KEY,
            owner_user_id varchar(80) NOT NULL REFERENCES customers(user_id),
            category_code varchar(40) NOT NULL REFERENCES service_categories(code),
            title varchar(120) NOT NULL,
            description text NOT NULL,
            service_mode varchar(10) NOT NULL CHECK (service_mode IN ('remote', 'onsite')),
            region_name varchar(100),
            price_from integer NOT NULL CHECK (price_from >= 0),
            status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (length(btrim(title)) > 0),
            CHECK (length(btrim(description)) > 0)
        );
        CREATE INDEX ix_services_browse ON services(category_code, created_at DESC) WHERE status = 'active';
        CREATE INDEX ix_services_owner ON services(owner_user_id, created_at DESC);

        CREATE TABLE quote_requests (
            id uuid PRIMARY KEY,
            owner_user_id varchar(80) NOT NULL REFERENCES customers(user_id),
            category_code varchar(40) NOT NULL REFERENCES service_categories(code),
            title varchar(120) NOT NULL,
            description text NOT NULL,
            service_mode varchar(10) NOT NULL CHECK (service_mode IN ('remote','onsite')),
            region_name varchar(100),
            budget_max integer CHECK (budget_max >= 0),
            status varchar(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (length(btrim(title)) > 0),
            CHECK (length(btrim(description)) > 0)
        );
        CREATE INDEX ix_quotes_browse ON quote_requests(category_code, created_at DESC) WHERE status = 'open';
        CREATE INDEX ix_quotes_owner ON quote_requests(owner_user_id, created_at DESC);

        CREATE TABLE proposals (
            id uuid PRIMARY KEY,
            quote_request_id uuid NOT NULL REFERENCES quote_requests(id),
            expert_user_id varchar(80) NOT NULL REFERENCES customers(user_id),
            service_id uuid NOT NULL REFERENCES services(id),
            room_id uuid NOT NULL REFERENCES chat_rooms(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (quote_request_id, expert_user_id)
        );
        CREATE INDEX ix_proposals_expert ON proposals(expert_user_id, created_at DESC);

        CREATE TABLE service_favorites (
            user_id varchar(80) NOT NULL REFERENCES customers(user_id),
            service_id uuid NOT NULL REFERENCES services(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY(user_id, service_id)
        );
    """)


def downgrade():
    op.execute("DROP TABLE service_favorites")
    op.execute("DROP TABLE proposals")
    op.execute("DROP TABLE quote_requests")
    op.execute("DROP TABLE services")
