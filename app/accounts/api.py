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
TEST_ACCOUNTS = {
    "TEST-CI-KIMGOSU-CONSUMER-001": ("테스트 일반 1", date(1991, 1, 15), "테스트 주소 1", False),
    "TEST-CI-KIMGOSU-CONSUMER-002": ("테스트 일반 2", date(1992, 2, 16), "테스트 주소 2", False),
    "TEST-CI-KIMGOSU-EXPERT-001": ("테스트 고수 1", date(1987, 3, 17), "테스트 주소 3", True),
    "TEST-CI-KIMGOSU-EXPERT-002": ("테스트 고수 2", date(1988, 4, 18), "테스트 주소 4", True),
}


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
    profile = TEST_ACCOUNTS.get(payload.ci)
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
