"""Run inside the API container against its migrated PostgreSQL database."""

from uuid import uuid4
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text

from app.accounts.identity import ci_lookup_hash, find_customer_by_ci, new_user_id, register_or_find_customer
from app.settings import database_url


def main():
    secret = b"test-only-lookup-secret-32-bytes-minimum"
    ci = f"TEST-CI-{uuid4()}"
    assert new_user_id("kakao").startswith("kakao_")
    assert len(ci_lookup_hash(ci, secret)) == 64
    engine = create_engine(database_url())
    try:
        with engine.connect() as connection:
            first = register_or_find_customer(connection, "kakao", ci, secret)
            same = register_or_find_customer(connection, "naver", ci, secret)
            assert first == same and first.startswith("kakao_")
            assert find_customer_by_ci(connection, ci, secret) == first
            assert find_customer_by_ci(connection, ci + "-other", secret) is None
            row = connection.execute(text("""
                SELECT user_id, ci_lookup_hash FROM customers WHERE user_id = :user_id
            """), {"user_id": first}).mappings().one()
            assert row["ci_lookup_hash"].strip() == ci_lookup_hash(ci, secret)
            assert ci not in row.values()
            # No commit: test customer disappears when the connection closes.
    finally:
        engine.dispose()
    print("PASS: prefixed customer PK, indexed CI lookup and cross-provider reuse")


if __name__ == "__main__":
    main()
