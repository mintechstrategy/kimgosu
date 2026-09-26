"""Transport-neutral chat API. A subject links any future product domain to chat."""

import asyncio
import json
import logging
import os
from pathlib import Path
import secrets
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.chat.auth import identity, require_subject_writer


logger = logging.getLogger(__name__)
router = APIRouter()


class SubjectCreate(BaseModel):
    subjectType: str = Field(pattern=r"^[a-z][a-z0-9_]{1,79}$")
    subjectId: UUID
    ownerUserId: UUID


class RoomCreate(BaseModel):
    subjectId: UUID


class MessageCreate(BaseModel):
    clientMessageId: UUID
    text: str = Field(default="", max_length=4000)
    attachmentIds: list[UUID] = Field(default_factory=list, max_length=5)


class ReadUpdate(BaseModel):
    throughMessageId: UUID


def db(request: Request):
    return request.app.state.db


def room_for_user(connection, room_id: UUID, user_id: UUID):
    row = connection.execute(text("""
        SELECT r.id, r.subject_id, s.subject_type, s.subject_id AS external_subject_id,
               s.owner_user_id, r.created_at, r.last_message_at, p.last_read_message_id
        FROM chat_rooms r
        JOIN chat_subjects s ON s.id = r.subject_id
        JOIN chat_participants p ON p.room_id = r.id
        WHERE r.id = :room_id AND p.user_id = :user_id
    """), {"room_id": room_id, "user_id": user_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Chat room not found")
    return row


def serialize_attachment(row):
    return {"id": str(row["id"]), "filename": row["filename"],
            "contentType": row["content_type"], "byteSize": row["byte_size"]}


def attachment_map(connection, message_ids):
    result = {message_id: [] for message_id in message_ids}
    if message_ids:
        rows = connection.execute(text("""
            SELECT id, message_id, filename, content_type, byte_size
            FROM chat_attachments WHERE message_id = ANY(:ids)
            ORDER BY created_at, id
        """), {"ids": list(message_ids)}).mappings()
        for row in rows:
            result[row["message_id"]].append(serialize_attachment(row))
    return result


def serialize_message(row, attachments=None):
    return {
        "id": str(row["id"]),
        "roomId": str(row["room_id"]),
        "senderUserId": str(row["sender_user_id"]),
        "clientMessageId": str(row["client_message_id"]),
        "text": row["body"],
        "attachments": attachments or [],
        "createdAt": row["created_at"].isoformat(),
    }


def attachment_path(attachment_id: UUID) -> Path:
    return Path(os.environ["UPLOAD_DIR"]) / "chat" / str(attachment_id)


@router.post("/subjects", status_code=201)
def register_subject(body: SubjectCreate, request: Request, principal: dict = Depends(require_subject_writer)):
    """Called by a trusted domain service when its resource becomes chat-enabled."""
    subject_id = uuid4()
    with db(request).begin() as connection:
        row = connection.execute(text("""
            INSERT INTO chat_subjects (id, subject_type, subject_id, owner_user_id)
            VALUES (:id, :type, :external_id, :owner)
            ON CONFLICT (subject_type, subject_id) DO UPDATE
              SET owner_user_id = chat_subjects.owner_user_id
            RETURNING id, subject_type, subject_id, owner_user_id
        """), {"id": subject_id, "type": body.subjectType,
                "external_id": body.subjectId, "owner": body.ownerUserId}).mappings().one()
        if row["owner_user_id"] != body.ownerUserId:
            raise HTTPException(409, "Chat subject is owned by another user")
    return {"id": str(row["id"]), "subjectType": row["subject_type"],
            "subjectId": str(row["subject_id"]), "ownerUserId": str(row["owner_user_id"])}


@router.post("/rooms", status_code=201)
def open_room(body: RoomCreate, request: Request, principal: dict = Depends(identity)):
    user_id = principal["user_id"]
    room_id = uuid4()
    with db(request).begin() as connection:
        subject = connection.execute(text("""
            SELECT id, owner_user_id FROM chat_subjects
            WHERE id = :id AND active = true FOR SHARE
        """), {"id": body.subjectId}).mappings().first()
        if subject is None:
            raise HTTPException(404, "Chat subject not found")
        if subject["owner_user_id"] == user_id:
            raise HTTPException(403, "Cannot open a room with yourself")
        row = connection.execute(text("""
            INSERT INTO chat_rooms (id, subject_id, initiated_by)
            VALUES (:id, :subject_id, :user_id)
            ON CONFLICT (subject_id, initiated_by) DO NOTHING
            RETURNING id
        """), {"id": room_id, "subject_id": body.subjectId, "user_id": user_id}).mappings().first()
        actual_id = row["id"] if row else connection.execute(text("""
            SELECT id FROM chat_rooms WHERE subject_id = :subject_id AND initiated_by = :user_id
        """), {"subject_id": body.subjectId, "user_id": user_id}).scalar_one()
        if row:
            connection.execute(text("""
                INSERT INTO chat_participants (room_id, user_id)
                VALUES (:room_id, :initiator), (:room_id, :owner)
            """), {"room_id": actual_id, "initiator": user_id,
                    "owner": subject["owner_user_id"]})
    return {"id": str(actual_id), "subjectId": str(body.subjectId), "created": bool(row)}


@router.get("/rooms")
def list_rooms(request: Request, limit: int = Query(20, ge=1, le=50), cursor: UUID | None = None,
               principal: dict = Depends(identity)):
    with db(request).connect() as connection:
        cursor_clause = ""
        cursor_values = {"cursor_time": None, "cursor_id": None}
        if cursor:
            current = connection.execute(text("""
                SELECT COALESCE(r.last_message_at, r.created_at) AS sort_time, r.id
                FROM chat_rooms r JOIN chat_participants p ON p.room_id = r.id
                WHERE r.id = :id AND p.user_id = :user_id
            """), {"id": cursor, "user_id": principal["user_id"]}).mappings().first()
            if current is None:
                raise HTTPException(400, "Invalid room cursor")
            cursor_clause = "AND (COALESCE(r.last_message_at, r.created_at), r.id) < (:cursor_time, :cursor_id)"
            cursor_values = {"cursor_time": current["sort_time"], "cursor_id": current["id"]}
        rows = connection.execute(text(f"""
            SELECT r.id, r.subject_id, s.subject_type, s.subject_id AS external_subject_id,
                   r.created_at, r.last_message_at, p.last_read_message_id,
                   (SELECT count(*) FROM chat_messages m
                    LEFT JOIN chat_messages last_read ON last_read.id = p.last_read_message_id
                    WHERE m.room_id = r.id AND m.sender_user_id <> :user_id
                      AND (last_read.id IS NULL OR (m.created_at, m.id) >
                           (last_read.created_at, last_read.id))) AS unread_count
            FROM chat_participants p
            JOIN chat_rooms r ON r.id = p.room_id
            JOIN chat_subjects s ON s.id = r.subject_id
            WHERE p.user_id = :user_id
              {cursor_clause}
            ORDER BY COALESCE(r.last_message_at, r.created_at) DESC, r.id DESC
            LIMIT :limit
        """), {"user_id": principal["user_id"], "limit": limit + 1, **cursor_values}).mappings().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {"items": [
        {"id": str(r["id"]), "subjectId": str(r["subject_id"]),
         "subjectType": r["subject_type"], "externalSubjectId": str(r["external_subject_id"]),
         "lastMessageAt": r["last_message_at"], "unreadCount": r["unread_count"]}
        for r in rows
    ], "nextCursor": str(rows[-1]["id"]) if has_more else None}


@router.get("/rooms/{room_id}")
def get_room(room_id: UUID, request: Request, principal: dict = Depends(identity)):
    with db(request).connect() as connection:
        row = room_for_user(connection, room_id, principal["user_id"])
        participants = connection.execute(text("""
            SELECT user_id FROM chat_participants WHERE room_id = :room_id
        """), {"room_id": room_id}).scalars().all()
    return {"id": str(row["id"]), "subjectId": str(row["subject_id"]),
            "subjectType": row["subject_type"],
            "externalSubjectId": str(row["external_subject_id"]),
            "participantIds": [str(x) for x in participants],
            "lastReadMessageId": str(row["last_read_message_id"]) if row["last_read_message_id"] else None}


@router.get("/rooms/{room_id}/messages")
def list_messages(room_id: UUID, request: Request, before: UUID | None = None,
                  limit: int = Query(30, ge=1, le=100), principal: dict = Depends(identity)):
    with db(request).connect() as connection:
        room_for_user(connection, room_id, principal["user_id"])
        cursor = None
        if before:
            cursor = connection.execute(text("""
                SELECT created_at, id FROM chat_messages WHERE id = :id AND room_id = :room_id
            """), {"id": before, "room_id": room_id}).mappings().first()
            if cursor is None:
                raise HTTPException(400, "Invalid message cursor")
        cursor_clause = "AND (created_at, id) < (:cursor_time, :cursor_id)" if cursor else ""
        rows = connection.execute(text(f"""
            SELECT id, room_id, sender_user_id, client_message_id, body, created_at
            FROM chat_messages WHERE room_id = :room_id
              {cursor_clause}
            ORDER BY created_at DESC, id DESC LIMIT :limit
        """), {"room_id": room_id, "cursor_time": cursor["created_at"] if cursor else None,
                "cursor_id": cursor["id"] if cursor else None, "limit": limit + 1}).mappings().all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        files = attachment_map(connection, [row["id"] for row in rows])
    return {"items": [serialize_message(x, files[x["id"]]) for x in reversed(rows)],
            "nextCursor": str(rows[-1]["id"]) if has_more else None}


@router.post("/rooms/{room_id}/attachments", status_code=201)
def upload_attachment(room_id: UUID, request: Request, file: UploadFile = File(...),
                      principal: dict = Depends(identity)):
    attachment_id = uuid4()
    path = attachment_path(attachment_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    filename = (file.filename or "file").replace("\\", "/").split("/")[-1]
    filename = "".join(ch for ch in filename if ch.isprintable())[:255] or "file"
    content_type = (file.content_type or "application/octet-stream")[:255]
    byte_size = 0
    try:
        with db(request).connect() as connection:
            room_for_user(connection, room_id, principal["user_id"])
        with path.open("xb") as output:
            while chunk := file.file.read(1024 * 1024):
                byte_size += len(chunk)
                if byte_size > 100 * 1024 * 1024:
                    raise HTTPException(413, "Attachment exceeds 100 MB")
                output.write(chunk)
        if byte_size == 0:
            raise HTTPException(422, "Empty attachment")
        with db(request).begin() as connection:
            connection.execute(text("""
                INSERT INTO chat_attachments
                  (id, room_id, uploader_user_id, filename, content_type, byte_size)
                VALUES (:id, :room_id, :user_id, :filename, :content_type, :byte_size)
            """), {"id": attachment_id, "room_id": room_id,
                    "user_id": principal["user_id"], "filename": filename,
                    "content_type": content_type, "byte_size": byte_size})
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return {"id": str(attachment_id), "filename": filename,
            "contentType": content_type, "byteSize": byte_size}


@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: UUID, request: Request,
                        principal: dict = Depends(identity)):
    with db(request).connect() as connection:
        row = connection.execute(text("""
            SELECT a.room_id, a.filename, a.message_id FROM chat_attachments a
            JOIN chat_participants p ON p.room_id = a.room_id
            WHERE a.id = :id AND p.user_id = :user_id
        """), {"id": attachment_id, "user_id": principal["user_id"]}).mappings().first()
        if row is None or row["message_id"] is None:
            raise HTTPException(404, "Attachment not found")
    path = attachment_path(attachment_id)
    if not path.is_file():
        raise HTTPException(404, "Attachment file missing")
    return FileResponse(path, filename=row["filename"], media_type="application/octet-stream",
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.delete("/attachments/{attachment_id}", status_code=204)
def discard_attachment(attachment_id: UUID, request: Request,
                       principal: dict = Depends(identity)):
    with db(request).begin() as connection:
        deleted = connection.execute(text("""
            DELETE FROM chat_attachments
            WHERE id = :id AND uploader_user_id = :user_id AND message_id IS NULL
            RETURNING id
        """), {"id": attachment_id, "user_id": principal["user_id"]}).scalar_one_or_none()
        if deleted is None:
            raise HTTPException(404, "Unsent attachment not found")
    attachment_path(attachment_id).unlink(missing_ok=True)


@router.post("/rooms/{room_id}/messages", status_code=201)
async def send_message(room_id: UUID, body: MessageCreate, request: Request,
                       principal: dict = Depends(identity)):
    message_text = body.text.strip()
    if not message_text and not body.attachmentIds:
        raise HTTPException(422, "Message needs text or an attachment")
    if len(set(body.attachmentIds)) != len(body.attachmentIds):
        raise HTTPException(422, "Duplicate attachment ID")
    def persist():
        with db(request).begin() as connection:
            room_for_user(connection, room_id, principal["user_id"])
            row = connection.execute(text("""
            INSERT INTO chat_messages (id, room_id, sender_user_id, client_message_id, body)
            VALUES (:id, :room_id, :sender, :client_id, :body)
            ON CONFLICT (room_id, sender_user_id, client_message_id) DO NOTHING
            RETURNING id, room_id, sender_user_id, client_message_id, body, created_at
            """), {"id": uuid4(), "room_id": room_id, "sender": principal["user_id"],
                    "client_id": body.clientMessageId, "body": message_text}).mappings().first()
            created = row is not None
            if not created:
                row = connection.execute(text("""
                SELECT id, room_id, sender_user_id, client_message_id, body, created_at
                FROM chat_messages WHERE room_id = :room_id AND sender_user_id = :sender
                  AND client_message_id = :client_id
                """), {"room_id": room_id, "sender": principal["user_id"],
                        "client_id": body.clientMessageId}).mappings().one()
                if row["body"] != message_text:
                    raise HTTPException(409, "clientMessageId was already used for different content")
                files = attachment_map(connection, [row["id"]])[row["id"]]
                if {UUID(item["id"]) for item in files} != set(body.attachmentIds):
                    raise HTTPException(409, "clientMessageId was already used for different attachments")
            else:
                if body.attachmentIds:
                    attached = connection.execute(text("""
                        UPDATE chat_attachments SET message_id = :message_id
                        WHERE id = ANY(:ids) AND room_id = :room_id
                          AND uploader_user_id = :user_id AND message_id IS NULL
                        RETURNING id
                    """), {"message_id": row["id"], "ids": body.attachmentIds,
                            "room_id": room_id, "user_id": principal["user_id"]}).scalars().all()
                    if len(attached) != len(body.attachmentIds):
                        raise HTTPException(409, "Attachment is missing, owned by another user, or already sent")
                connection.execute(text("""
                UPDATE chat_rooms
                SET last_message_at = GREATEST(COALESCE(last_message_at, :created_at), :created_at)
                WHERE id = :room_id
                """), {"created_at": row["created_at"], "room_id": room_id})
                files = attachment_map(connection, [row["id"]])[row["id"]]
            return serialize_message(row, files), created

    result, created = await run_in_threadpool(persist)
    if created:
        try:
            await request.app.state.chat_events.publish(f"chat.room.{room_id}", json.dumps({"type": "message.created", "message": result}))
        except Exception:
            logger.exception("Chat event publish failed after message commit")
    return result


@router.post("/rooms/{room_id}/read")
async def mark_read(room_id: UUID, body: ReadUpdate, request: Request,
                    principal: dict = Depends(identity)):
    def update():
        with db(request).begin() as connection:
            room_for_user(connection, room_id, principal["user_id"])
            last_read_id = connection.execute(text("""
                SELECT last_read_message_id FROM chat_participants
                WHERE room_id = :room_id AND user_id = :user_id FOR UPDATE
            """), {"room_id": room_id, "user_id": principal["user_id"]}).scalar_one()
            target = connection.execute(text("""
            SELECT id, created_at FROM chat_messages WHERE id = :id AND room_id = :room_id
            """), {"id": body.throughMessageId, "room_id": room_id}).mappings().first()
            if target is None:
                raise HTTPException(400, "Message is not in this room")
            if last_read_id:
                previous = connection.execute(text("""
                SELECT id, created_at FROM chat_messages WHERE id = :id
                """), {"id": last_read_id}).mappings().one()
                if (target["created_at"], target["id"]) <= (previous["created_at"], previous["id"]):
                    return str(previous["id"]), False
            connection.execute(text("""
            UPDATE chat_participants SET last_read_message_id = :message_id
            WHERE room_id = :room_id AND user_id = :user_id
            """), {"message_id": target["id"], "room_id": room_id,
                    "user_id": principal["user_id"]})
            return str(target["id"]), True

    message_id, changed = await run_in_threadpool(update)
    if changed:
        try:
            await request.app.state.chat_events.publish(f"chat.room.{room_id}", json.dumps({
                "type": "message.read", "userId": str(principal["user_id"]),
                "throughMessageId": message_id,
            }))
        except Exception:
            logger.exception("Read event publish failed after commit")
    return {"lastReadMessageId": message_id}


@router.post("/rooms/{room_id}/ws-ticket")
async def ws_ticket(room_id: UUID, request: Request, principal: dict = Depends(identity)):
    def verify_room():
        with db(request).connect() as connection:
            room_for_user(connection, room_id, principal["user_id"])

    await run_in_threadpool(verify_room)
    ticket = secrets.token_urlsafe(32)
    await request.app.state.chat_events.set(
        f"chat.ticket.{ticket}", json.dumps({"roomId": str(room_id), "userId": str(principal["user_id"])}), ex=30
    )
    return {"ticket": ticket, "expiresInSeconds": 30}


@router.websocket("/ws/rooms/{room_id}")
async def room_events(websocket: WebSocket, room_id: UUID, ticket: str):
    allowed_origins = [x.strip() for x in os.getenv("FRONTEND_ORIGINS", "").split(",") if x.strip()]
    origin = websocket.headers.get("origin")
    if origin and allowed_origins and origin not in allowed_origins:
        await websocket.close(code=4403)
        return
    value = await websocket.app.state.chat_events.getdel(f"chat.ticket.{ticket}")
    if not value:
        await websocket.close(code=4401)
        return
    claims = json.loads(value)
    if claims["roomId"] != str(room_id):
        await websocket.close(code=4403)
        return
    def verify_room():
        with websocket.app.state.db.connect() as connection:
            room_for_user(connection, room_id, UUID(claims["userId"]))

    try:
        await run_in_threadpool(verify_room)
    except HTTPException:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    pubsub = websocket.app.state.chat_events.pubsub()
    await pubsub.subscribe(f"chat.room.{room_id}")

    async def forward():
        async for event in pubsub.listen():
            if event["type"] == "message":
                await websocket.send_text(event["data"])

    task = asyncio.create_task(forward())
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await pubsub.aclose()
