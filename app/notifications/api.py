"""Inbox events are created in the same transaction as their source action."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text

from app.chat.auth import identity


router = APIRouter()


def notify(connection, *, recipient: str, actor: str, event_type: str,
           source_id: UUID, room_id: UUID, title: str, body: str):
    if recipient == actor:
        return
    connection.execute(text("""
        INSERT INTO notifications
          (id, recipient_user_id, actor_user_id, event_type, source_id, room_id, title, body)
        VALUES (:id, :recipient, :actor, :event_type, :source_id, :room_id, :title, :body)
        ON CONFLICT (recipient_user_id, event_type, source_id) DO NOTHING
    """), {"id": uuid4(), "recipient": recipient, "actor": actor,
           "event_type": event_type, "source_id": source_id, "room_id": room_id,
           "title": title[:160], "body": body[:300]})


def _item(row):
    return {"id": str(row["id"]), "eventType": row["event_type"],
            "roomId": str(row["room_id"]) if row["room_id"] else None,
            "title": row["title"], "body": row["body"],
            "createdAt": row["created_at"], "readAt": row["read_at"]}


@router.get("/notifications")
def list_notifications(request: Request, limit: int = Query(20, ge=1, le=50),
                       cursor: UUID | None = None, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        before = None
        if cursor:
            before = connection.execute(text("""
                SELECT created_at, id FROM notifications
                WHERE id=:id AND recipient_user_id=:recipient
            """), {"id": cursor, "recipient": principal["user_id"]}).mappings().first()
            if before is None:
                raise HTTPException(404, "Notification cursor not found")
        cursor_filter = "AND (created_at, id) < (:before_time, :before_id)" if before else ""
        rows = connection.execute(text(f"""
            SELECT id,event_type,room_id,title,body,created_at,read_at FROM notifications
            WHERE recipient_user_id=:recipient {cursor_filter}
            ORDER BY created_at DESC,id DESC LIMIT :limit
        """), {"recipient": principal["user_id"], "limit": limit + 1,
               "before_time": before["created_at"] if before else None,
               "before_id": before["id"] if before else None}).mappings().all()
        unread = connection.execute(text("""
            SELECT count(*) FROM notifications
            WHERE recipient_user_id=:recipient AND read_at IS NULL
        """), {"recipient": principal["user_id"]}).scalar_one()
    visible = rows[:limit]
    return {"items": [_item(row) for row in visible],
            "nextCursor": str(visible[-1]["id"]) if len(rows) > limit else None,
            "unreadCount": unread}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: UUID, request: Request,
                           principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        row = connection.execute(text("""
            UPDATE notifications SET read_at=COALESCE(read_at,now())
            WHERE id=:id AND recipient_user_id=:recipient
            RETURNING id,event_type,room_id,title,body,created_at,read_at
        """), {"id": notification_id, "recipient": principal["user_id"]}).mappings().first()
    if row is None:
        raise HTTPException(404, "Notification not found")
    return _item(row)
