"""Manage home service categories as ordered codes."""

from alembic import op

revision = "0006_service_categories"
down_revision = "0005_customer_profile"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE service_categories (
            code varchar(40) PRIMARY KEY,
            display_name varchar(80) NOT NULL,
            display_order integer NOT NULL UNIQUE,
            icon_key varchar(40) NOT NULL,
            is_visible boolean NOT NULL DEFAULT true,
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_service_category_code CHECK (code ~ '^[a-z][a-z0-9_]*$'),
            CONSTRAINT ck_service_category_name CHECK (length(btrim(display_name)) > 0),
            CONSTRAINT ck_service_category_order CHECK (display_order > 0)
        );
        INSERT INTO service_categories (code, display_name, display_order, icon_key) VALUES
            ('design_development', '디자인/개발', 10, 'pencil'),
            ('video_editing', '영상편집', 20, 'video'),
            ('translation', '번역', 30, 'language'),
            ('legal', '법률', 40, 'scales'),
            ('cleaning_interior', '청소/인테리어', 50, 'broom'),
            ('pets', '반려', 60, 'paw'),
            ('hair_beauty', '헤어/미용', 70, 'scissors');
    """)


def downgrade():
    op.execute("DROP TABLE service_categories")
