"""Customer ledger API and the LAN-only synthetic login used by debug builds."""

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.accounts.identity import register_or_find_customer
from app.chat.auth import identity


router = APIRouter()

# These values are synthetic. Never accept a caller-supplied user_id or profile.
def test_profile(ci: str):
    """Fixed synthetic identities; arbitrary caller-supplied CIs never enroll."""
    parts = ci.split("-")
    if len(parts) != 5 or parts[:3] != ["TEST", "CI", "KIMGOSU"]:
        return None
    role, number = parts[3:]
    if role not in {"CONSUMER", "EXPERT"} or len(number) != 3 or any(ch not in "0123456789" for ch in number):
        return None
    index = int(number)
    if not 1 <= index <= 50:
        return None
    expert = role == "EXPERT"
    name = f"테스트 {'고수' if expert else '일반'} {index}"
    if index <= 2:
        birth = (date(1987, 3, 17), date(1988, 4, 18))[index - 1] if expert else (
            date(1991, 1, 15), date(1992, 2, 16))[index - 1]
    else:
        birth = date(1987 if expert else 1991, 1 + (index - 1) % 12, 1 + (index - 1) % 28)
    address = "서울특별시 영등포구" if expert else "서울특별시 강남구"
    return name, birth, address, expert


class CustomerResponse(BaseModel):
    userId: str
    customerName: str | None
    birthDate: date | None
    homeAddress: str | None
    phoneNumber: str | None
    expertEnabled: bool
    createdAt: datetime
    updatedAt: datetime


class TestLoginRequest(BaseModel):
    ci: str = Field(min_length=1, max_length=100)


class LoginResponse(BaseModel):
    accessToken: str
    tokenType: str
    expiresIn: int
    customer: CustomerResponse


class CustomerUpdate(BaseModel):
    customerName: str | None = Field(default=None, min_length=1, max_length=100)
    birthDate: date | None = None
    homeAddress: str | None = Field(default=None, max_length=500)
    phoneNumber: str | None = Field(default=None, max_length=30)


CUSTOMER_QUERY = text("""
    SELECT user_id AS "userId", customer_name AS "customerName",
           birth_date AS "birthDate", home_address AS "homeAddress",
           phone_number AS "phoneNumber", expert_enabled AS "expertEnabled",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM customers WHERE user_id = :user_id
""")


def _customer(connection, user_id: str) -> dict:
    row = connection.execute(CUSTOMER_QUERY, {"user_id": user_id}).mappings().one_or_none()
    if row is None:
        raise HTTPException(404, "Customer not found")
    return dict(row)


def _jwt(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    secret = Path(os.environ["JWT_SECRET_FILE"]).read_text().strip()
    return jwt.encode({"sub": user_id, "iss": "kimgosu", "aud": "kimgosu-api",
                       "iat": now, "exp": now + timedelta(hours=1), "scope": ""},
                      secret, algorithm="HS256")


@router.post("/auth/test-login", response_model=LoginResponse)
def test_login(payload: TestLoginRequest, request: Request):
    if os.getenv("TEST_LOGIN_ENABLED") != "true":
        raise HTTPException(404, "Not found")
    profile = test_profile(payload.ci)
    if profile is None:
        raise HTTPException(401, "Unknown test identity")
    ci_secret = Path(os.environ["CI_LOOKUP_KEY_FILE"]).read_bytes().strip()
    with request.app.state.db.begin() as connection:
        user_id = register_or_find_customer(
            connection, "test", payload.ci, ci_secret,
            customer_name=profile[0], birth_date=profile[1],
            home_address=profile[2], expert_enabled=profile[3],
        )
        customer = _customer(connection, user_id)
    return {"accessToken": _jwt(user_id), "tokenType": "Bearer",
            "expiresIn": 3600, "customer": customer}


@router.get("/customers/me", response_model=CustomerResponse)
def my_customer(request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        return _customer(connection, principal["user_id"])


@router.patch("/customers/me", response_model=CustomerResponse)
def update_my_customer(payload: CustomerUpdate, request: Request,
                       principal: dict = Depends(identity)):
    fields = payload.model_dump(exclude_unset=True)
    if "customerName" in fields and (fields["customerName"] is None or not fields["customerName"].strip()):
        raise HTTPException(422, "Customer name cannot be empty")
    columns = {"customerName": "customer_name", "birthDate": "birth_date",
               "homeAddress": "home_address", "phoneNumber": "phone_number"}
    with request.app.state.db.begin() as connection:
        _customer(connection, principal["user_id"])
        if fields:
            assignments = ", ".join(f"{columns[key]} = :{key}" for key in fields)
            connection.execute(text(f"""
                UPDATE customers SET {assignments}, updated_at = now()
                WHERE user_id = :user_id
            """), {**fields, "user_id": principal["user_id"]})
        return _customer(connection, principal["user_id"])
