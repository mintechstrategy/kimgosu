"""Public, read-only catalog for mobile and future web clients."""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import text

router = APIRouter()


class Category(BaseModel):
    code: str
    displayName: str
    displayOrder: int
    iconKey: str


@router.get("/home-categories", response_model=list[Category])
def home_categories(request: Request):
    with request.app.state.db.connect() as connection:
        rows = connection.execute(text("""
            SELECT code, display_name AS "displayName",
                   display_order AS "displayOrder", icon_key AS "iconKey"
            FROM service_categories
            WHERE is_visible = true
            ORDER BY display_order, code
        """)).mappings().all()
    return [dict(row) for row in rows]
