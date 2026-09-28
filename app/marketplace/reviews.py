"""Completion and review rules bound to generic two-party chat rooms."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.chat.auth import identity
from app.notifications.api import notify

router = APIRouter()


class ReviewWrite(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str = Field(min_length=10, max_length=1000)


def _participants(connection, room_id: UUID):
    participants = connection.execute(text("""
        SELECT user_id FROM chat_participants WHERE room_id=:room ORDER BY user_id
    """), {"room": room_id}).scalars().all()
    if len(participants) != 2:
        raise HTTPException(404, "Two-party room not found")
    return participants


def _completion(connection, room_id: UUID, user_id: str):
    participants = _participants(connection, room_id)
    if user_id not in participants:
        raise HTTPException(404, "Room not found")
    confirmed = set(connection.execute(text("""
        SELECT user_id FROM chat_completion_confirmations WHERE room_id=:room
    """), {"room": room_id}).scalars().all())
    reviewed = connection.execute(text("""
        SELECT 1 FROM reviews WHERE room_id=:room AND reviewer_user_id=:user
    """), {"room": room_id, "user": user_id}).first() is not None
    return {"roomId": str(room_id), "myConfirmed": user_id in confirmed,
            "counterpartConfirmed": any(p in confirmed for p in participants if p != user_id),
            "completed": set(participants) <= confirmed, "myReviewed": reviewed}


@router.get("/chat/rooms/{room_id}/completion")
def get_completion(room_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        return _completion(connection, room_id, principal["user_id"])


@router.post("/chat/rooms/{room_id}/completion")
def confirm_completion(room_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        _completion(connection, room_id, principal["user_id"])
        connection.execute(text("""
            INSERT INTO chat_completion_confirmations(room_id,user_id)
            VALUES (:room,:user) ON CONFLICT DO NOTHING
        """), {"room": room_id, "user": principal["user_id"]})
        return _completion(connection, room_id, principal["user_id"])


@router.post("/chat/rooms/{room_id}/reviews", status_code=201)
def create_review(room_id: UUID, body: ReviewWrite, request: Request,
                  principal: dict = Depends(identity)):
    if len(body.body.strip()) < 10:
        raise HTTPException(422, "Review body must have at least 10 visible characters")
    with request.app.state.db.begin() as connection:
        state = _completion(connection, room_id, principal["user_id"])
        if not state["completed"]:
            raise HTTPException(409, "Both participants must confirm completion")
        if state["myReviewed"]:
            raise HTTPException(409, "Review already submitted")
        participants = _participants(connection, room_id)
        target = next(p for p in participants if p != principal["user_id"])
        review_id = uuid4()
        row = connection.execute(text("""
            INSERT INTO reviews(id,room_id,reviewer_user_id,target_user_id,rating,body)
            VALUES (:id,:room,:reviewer,:target,:rating,:body)
            ON CONFLICT(room_id,reviewer_user_id) DO NOTHING
            RETURNING id,created_at
        """), {"id": review_id, "room": room_id, "reviewer": principal["user_id"],
               "target": target, "rating": body.rating, "body": body.body.strip()}).mappings().first()
        if row is None:
            raise HTTPException(409, "Review already submitted")
        notify(connection, recipient=target, actor=principal["user_id"],
               event_type="review.created", source_id=row["id"], room_id=room_id,
               title="새 리뷰", body=body.body.strip())
        return {"id": str(row["id"]), "roomId": str(room_id),
                "reviewerUserId": principal["user_id"], "targetUserId": target,
                "rating": body.rating, "body": body.body.strip(), "createdAt": row["created_at"]}


@router.get("/chat/rooms/{room_id}/reviews")
def list_reviews(room_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        _completion(connection, room_id, principal["user_id"])
        rows = connection.execute(text("""
            SELECT id,reviewer_user_id,target_user_id,rating,body,created_at
            FROM reviews WHERE room_id=:room ORDER BY created_at,id
        """), {"room": room_id}).mappings().all()
        return {"items": [{"id": str(r["id"]), "roomId": str(room_id),
                           "reviewerUserId": r["reviewer_user_id"],
                           "targetUserId": r["target_user_id"], "rating": r["rating"],
                           "body": r["body"], "createdAt": r["created_at"]} for r in rows]}
