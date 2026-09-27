"""Profile fields for the customer ledger."""

from alembic import op

revision = "0005_customer_profile"
down_revision = "0004_customer_identity"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        ALTER TABLE customers
            ADD COLUMN customer_name varchar(100),
            ADD COLUMN birth_date date,
            ADD COLUMN home_address varchar(500),
            ADD COLUMN phone_number varchar(30),
            ADD COLUMN expert_enabled boolean NOT NULL DEFAULT false,
            ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
        ALTER TABLE customers
            ADD CONSTRAINT ck_customer_name_nonempty
            CHECK (customer_name IS NULL OR length(btrim(customer_name)) > 0);
    """)


def downgrade():
    op.execute("""
        ALTER TABLE customers DROP CONSTRAINT ck_customer_name_nonempty;
        ALTER TABLE customers
            DROP COLUMN customer_name,
            DROP COLUMN birth_date,
            DROP COLUMN home_address,
            DROP COLUMN phone_number,
            DROP COLUMN expert_enabled,
            DROP COLUMN updated_at;
    """)
