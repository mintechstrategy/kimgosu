"""Customer-visible support intake; staff handling is a separate future boundary."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.chat.auth import identity


router = APIRouter()


class TicketWrite(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    body: str = Field(min_length=10, max_length=4000)


def _ticket(row):
    return {"id": str(row["id"]), "title": row["title"], "body": row["body"],
            "status": row["status"], "createdAt": row["created_at"]}


@router.post("/support/tickets", status_code=201)
def create_ticket(payload: TicketWrite, request: Request, principal: dict = Depends(identity)):
    title, body = payload.title.strip(), payload.body.strip()
    if len(title) < 2 or len(body) < 10:
        raise HTTPException(422, "Title or description is too short")
    ticket_id = uuid4()
    with request.app.state.db.begin() as connection:
        row = connection.execute(text("""
            INSERT INTO support_tickets(id, requester_user_id, title, body)
            VALUES (:id, :requester, :title, :body)
            RETURNING id, title, body, status, created_at
        """), {"id": ticket_id, "requester": principal["user_id"],
               "title": title, "body": body}).mappings().one()
    return _ticket(row)


@router.get("/support/tickets")
def list_tickets(request: Request, limit: int = Query(20, ge=1, le=50), cursor: UUID | None = None,
                 principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        before = None
        if cursor is not None:
            before = connection.execute(text("""
                SELECT created_at, id FROM support_tickets
                WHERE id=:cursor AND requester_user_id=:requester
            """), {"cursor": cursor, "requester": principal["user_id"]}).mappings().first()
            if before is None:
                raise HTTPException(404, "Support ticket cursor not found")
        cursor_filter = "AND (created_at, id) < (:before_time, :before_id)" if before else ""
        rows = connection.execute(text(f"""
            SELECT id, title, body, status, created_at FROM support_tickets
            WHERE requester_user_id=:requester
              {cursor_filter}
            ORDER BY created_at DESC, id DESC LIMIT :limit
        """), {"requester": principal["user_id"], "limit": limit + 1,
               "before_time": before["created_at"] if before else None,
               "before_id": before["id"] if before else None}).mappings().all()
    visible = rows[:limit]
    return {"items": [_ticket(row) for row in visible],
            "nextCursor": str(visible[-1]["id"]) if len(rows) > limit else None}


@router.get("/support/tickets/{ticket_id}")
def get_ticket(ticket_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        row = connection.execute(text("""
            SELECT id, title, body, status, created_at FROM support_tickets
            WHERE id=:id AND requester_user_id=:requester
        """), {"id": ticket_id, "requester": principal["user_id"]}).mappings().first()
    if row is None:
        raise HTTPException(404, "Support ticket not found")
    return _ticket(row)
