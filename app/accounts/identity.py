"""Internal identity mapping after a trusted provider supplies CI.

This module does not verify an OAuth token or issue a login session.
"""

import hashlib
import hmac
import re
from uuid import uuid4

from sqlalchemy import text


PROVIDER = re.compile(r"^[a-z][a-z0-9]{1,19}$")
USER_ID = re.compile(r"^[a-z][a-z0-9]*_[0-9a-f]{32}$")


def ci_lookup_hash(verified_ci: str, lookup_secret: bytes) -> str:
    if not verified_ci or not verified_ci.strip():
        raise ValueError("Verified CI is required")
    if len(lookup_secret) < 32:
        raise ValueError("CI lookup secret must be at least 32 bytes")
    return hmac.new(lookup_secret, verified_ci.encode("utf-8"), hashlib.sha256).hexdigest()


def new_user_id(provider: str) -> str:
    if not PROVIDER.fullmatch(provider):
        raise ValueError("Invalid identity provider")
    return f"{provider}_{uuid4().hex}"


def find_customer_by_ci(connection, verified_ci: str, lookup_secret: bytes) -> str | None:
    """Resolve login identity by indexed CI digest, never by client-supplied user ID."""
    digest = ci_lookup_hash(verified_ci, lookup_secret)
    return connection.execute(text("""
        SELECT user_id FROM customers WHERE ci_lookup_hash = :digest
    """), {"digest": digest}).scalar_one_or_none()


def register_or_find_customer(connection, provider: str, verified_ci: str,
                              lookup_secret: bytes, *, customer_name: str | None = None,
                              birth_date=None, home_address: str | None = None,
                              phone_number: str | None = None,
                              expert_enabled: bool = False) -> str:
    """Atomically bind first registration; same CI on another provider reuses PK."""
    digest = ci_lookup_hash(verified_ci, lookup_secret)
    candidate = new_user_id(provider)
    inserted = connection.execute(text("""
        INSERT INTO customers (user_id, ci_lookup_hash, customer_name, birth_date,
                               home_address, phone_number, expert_enabled)
        VALUES (:user_id, :digest, :customer_name, :birth_date,
                :home_address, :phone_number, :expert_enabled)
        ON CONFLICT (ci_lookup_hash) DO NOTHING
        RETURNING user_id
    """), {"user_id": candidate, "digest": digest, "customer_name": customer_name,
           "birth_date": birth_date, "home_address": home_address,
           "phone_number": phone_number, "expert_enabled": expert_enabled}).scalar_one_or_none()
    if inserted is not None:
        return inserted
    return connection.execute(text("""
        SELECT user_id FROM customers WHERE ci_lookup_hash = :digest
    """), {"digest": digest}).scalar_one()
