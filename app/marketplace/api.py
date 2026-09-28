"""Service, quote, proposal and favorite APIs shared by mobile and future web clients."""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.chat.auth import identity

router = APIRouter()


class ServiceWrite(BaseModel):
    categoryCode: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=10, max_length=4000)
    mode: str = Field(pattern=r"^(remote|onsite)$")
    regionName: str | None = Field(default=None, max_length=100)
    priceFrom: int = Field(ge=0, le=1000000000)


class QuoteWrite(BaseModel):
    categoryCode: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=10, max_length=4000)
    mode: str = Field(pattern=r"^(remote|onsite)$")
    regionName: str | None = Field(default=None, max_length=100)
    budgetMax: int | None = Field(default=None, ge=0, le=1000000000)


class ProposalWrite(BaseModel):
    serviceId: UUID


def _category(connection, code: str):
    if not connection.execute(text("SELECT 1 FROM service_categories WHERE code=:code AND is_visible"),
                              {"code": code}).first():
        raise HTTPException(422, "Unknown category")


def _row(connection, table: str, resource_id: UUID):
    # `table` is only supplied by this module's fixed call sites.
    row = connection.execute(text(f"SELECT * FROM {table} WHERE id=:id"),
                             {"id": resource_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Resource not found")
    return row


def _service(row):
    return {"id": str(row["id"]), "ownerUserId": row["owner_user_id"],
            "categoryCode": row["category_code"], "title": row["title"],
            "description": row["description"], "mode": row["service_mode"],
            "regionName": row["region_name"], "priceFrom": row["price_from"],
            "status": row["status"], "createdAt": row["created_at"]}


def _quote(row):
    return {"id": str(row["id"]), "ownerUserId": row["owner_user_id"],
            "categoryCode": row["category_code"], "title": row["title"],
            "description": row["description"], "mode": row["service_mode"],
            "regionName": row["region_name"], "budgetMax": row["budget_max"],
            "status": row["status"], "createdAt": row["created_at"]}


def _parse_regions(raw: str | None):
    if not raw:
        return None
    regions = [part.strip() for part in raw.split(",") if part.strip()]
    if not regions or len(regions) > 20 or any(len(part) > 100 for part in regions):
        raise HTTPException(422, "Invalid regions")
    return regions


def _browse(connection, table, category, query, limit, owner=None, regions=None,
            include_remote=True):
    # Fixed table names and predicates; all external values are bound parameters.
    if table not in {"services", "quote_requests"}:
        raise ValueError("Invalid table")
    state = "active" if table == "services" else "open"
    clauses = ["status=:status"] if owner is None else ["owner_user_id=:owner", "status<>'deleted'"]
    values = {"status": state, "owner": owner, "category": category,
              "pattern": f"%{query.strip()}%" if query else None, "limit": limit}
    if category:
        clauses.append("category_code=:category")
    if query:
        clauses.append("(title ILIKE :pattern OR description ILIKE :pattern)")
    if regions:
        clauses.append("(service_mode='remote' OR region_name=ANY(:regions))" if include_remote
                       else "(service_mode='onsite' AND region_name=ANY(:regions))")
        values["regions"] = regions
    where = " AND ".join(clauses)
    rows = connection.execute(text(f"SELECT * FROM {table} WHERE {where} "
                                   "ORDER BY created_at DESC, id DESC LIMIT :limit"), values).mappings().all()
    return {"items": [_service(row) if table == "services" else _quote(row) for row in rows],
            "nextCursor": None}


def _open_room(connection, subject_type: str, resource_id: UUID, owner: str,
               initiator: str, display_title: str):
    if owner == initiator:
        raise HTTPException(403, "Cannot open a room with yourself")
    subject = connection.execute(text("""
        INSERT INTO chat_subjects(id, subject_type, subject_id, owner_user_id, display_title)
        VALUES (:id, :type, :resource, :owner, :title)
        ON CONFLICT(subject_type, subject_id) DO UPDATE
          SET active=true, display_title=EXCLUDED.display_title
        RETURNING id, owner_user_id
    """), {"id": uuid4(), "type": subject_type, "resource": resource_id,
           "owner": owner, "title": display_title}).mappings().one()
    if subject["owner_user_id"] != owner:
        raise HTTPException(409, "Chat subject owner mismatch")
    created = connection.execute(text("""
        INSERT INTO chat_rooms(id, subject_id, initiated_by)
        VALUES (:id, :subject, :initiator)
        ON CONFLICT(subject_id, initiated_by) DO NOTHING RETURNING id
    """), {"id": uuid4(), "subject": subject["id"], "initiator": initiator}).scalar_one_or_none()
    room_id = created or connection.execute(text("""
        SELECT id FROM chat_rooms WHERE subject_id=:subject AND initiated_by=:initiator
    """), {"subject": subject["id"], "initiator": initiator}).scalar_one()
    if created:
        connection.execute(text("""
            INSERT INTO chat_participants(room_id, user_id)
            VALUES (:room, :owner), (:room, :initiator)
        """), {"room": room_id, "owner": owner, "initiator": initiator})
    return room_id


@router.get("/services")
def list_services(request: Request, categoryCode: str | None = None, q: str | None = None,
                  regions: str | None = None, includeRemote: bool = True,
                  limit: int = Query(20, ge=1, le=50)):
    with request.app.state.db.connect() as connection:
        return _browse(connection, "services", categoryCode, q, limit,
                       regions=_parse_regions(regions), include_remote=includeRemote)


@router.get("/me/services")
def my_services(request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        return _browse(connection, "services", None, None, 50, principal["user_id"])


@router.post("/services", status_code=201)
def create_service(body: ServiceWrite, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        expert = connection.execute(text("SELECT expert_enabled FROM customers WHERE user_id=:id"),
                                    {"id": principal["user_id"]}).scalar_one_or_none()
        if not expert:
            raise HTTPException(403, "Expert account required")
        _category(connection, body.categoryCode)
        if body.mode == "onsite" and not body.regionName:
            raise HTTPException(422, "Region is required for onsite services")
        resource_id = uuid4()
        connection.execute(text("""
            INSERT INTO services(id, owner_user_id, category_code, title, description,
                                 service_mode, region_name, price_from)
            VALUES (:id,:owner,:category,:title,:description,:mode,:region,:price)
        """), {"id": resource_id, "owner": principal["user_id"],
               "category": body.categoryCode, "title": body.title.strip(),
               "description": body.description.strip(), "mode": body.mode,
               "region": body.regionName, "price": body.priceFrom})
        return _service(_row(connection, "services", resource_id))


@router.get("/services/{service_id}")
def get_service(service_id: UUID, request: Request):
    with request.app.state.db.connect() as connection:
        row = _row(connection, "services", service_id)
        if row["status"] == "deleted":
            raise HTTPException(404, "Service not found")
        return _service(row)


@router.put("/services/{service_id}")
def update_service(service_id: UUID, body: ServiceWrite, request: Request,
                   principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        previous = _row(connection, "services", service_id)
        if previous["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Service owner required")
        if previous["status"] == "deleted":
            raise HTTPException(409, "Service was deleted")
        _category(connection, body.categoryCode)
        if body.mode == "onsite" and not body.regionName:
            raise HTTPException(422, "Region is required for onsite services")
        connection.execute(text("""
            UPDATE services SET category_code=:category,title=:title,description=:description,
              service_mode=:mode,region_name=:region,price_from=:price,updated_at=now()
            WHERE id=:id
        """), {"id": service_id, "category": body.categoryCode, "title": body.title.strip(),
               "description": body.description.strip(), "mode": body.mode,
               "region": body.regionName, "price": body.priceFrom})
        return _service(_row(connection, "services", service_id))


@router.post("/services/{service_id}/hide")
def hide_service(service_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        previous = _row(connection, "services", service_id)
        if previous["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Service owner required")
        if previous["status"] == "deleted":
            raise HTTPException(409, "Service was deleted")
        connection.execute(text("UPDATE services SET status='hidden',updated_at=now() WHERE id=:id"),
                           {"id": service_id})
        return _service(_row(connection, "services", service_id))


@router.delete("/services/{service_id}", status_code=204)
def delete_service(service_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        previous = _row(connection, "services", service_id)
        if previous["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Service owner required")
        connection.execute(text("UPDATE services SET status='deleted',updated_at=now() WHERE id=:id"),
                           {"id": service_id})


@router.post("/services/{service_id}/inquiries", status_code=201)
def inquire(service_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        service = _row(connection, "services", service_id)
        if service["status"] != "active":
            raise HTTPException(409, "Service is not active")
        room_id = _open_room(connection, "service", service_id,
                             service["owner_user_id"], principal["user_id"], service["title"])
        return {"chatRoomId": str(room_id)}


@router.put("/services/{service_id}/favorite", status_code=204)
def add_favorite(service_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        service = _row(connection, "services", service_id)
        if service["status"] != "active":
            raise HTTPException(409, "Service is not active")
        if service["owner_user_id"] == principal["user_id"]:
            raise HTTPException(403, "Cannot favorite your own service")
        connection.execute(text("""
            INSERT INTO service_favorites(user_id, service_id) VALUES (:user,:service)
            ON CONFLICT DO NOTHING
        """), {"user": principal["user_id"], "service": service_id})


@router.delete("/services/{service_id}/favorite", status_code=204)
def remove_favorite(service_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        connection.execute(text("DELETE FROM service_favorites WHERE user_id=:user AND service_id=:service"),
                           {"user": principal["user_id"], "service": service_id})


@router.get("/me/favorites")
def my_favorites(request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        rows = connection.execute(text("""
            SELECT s.* FROM service_favorites f JOIN services s ON s.id=f.service_id
            WHERE f.user_id=:user AND s.status='active'
            ORDER BY f.created_at DESC LIMIT 50
        """), {"user": principal["user_id"]}).mappings().all()
        return {"items": [_service(row) for row in rows], "nextCursor": None}


@router.get("/quote-requests")
def list_quotes(request: Request, categoryCode: str | None = None, q: str | None = None,
                regions: str | None = None, includeRemote: bool = True,
                limit: int = Query(20, ge=1, le=50)):
    with request.app.state.db.connect() as connection:
        return _browse(connection, "quote_requests", categoryCode, q, limit,
                       regions=_parse_regions(regions), include_remote=includeRemote)


@router.get("/me/quote-requests")
def my_quotes(request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        return _browse(connection, "quote_requests", None, None, 50, principal["user_id"])


@router.post("/quote-requests", status_code=201)
def create_quote(body: QuoteWrite, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        _category(connection, body.categoryCode)
        if body.mode == "onsite" and not body.regionName:
            raise HTTPException(422, "Region is required for onsite quotes")
        resource_id = uuid4()
        connection.execute(text("""
            INSERT INTO quote_requests(id, owner_user_id, category_code, title,
                                       description, service_mode, region_name, budget_max)
            VALUES (:id,:owner,:category,:title,:description,:mode,:region,:budget)
        """), {"id": resource_id, "owner": principal["user_id"],
               "category": body.categoryCode, "title": body.title.strip(),
               "description": body.description.strip(), "mode": body.mode,
               "region": body.regionName, "budget": body.budgetMax})
        return _quote(_row(connection, "quote_requests", resource_id))


@router.get("/quote-requests/{quote_id}")
def get_quote(quote_id: UUID, request: Request):
    with request.app.state.db.connect() as connection:
        row = _row(connection, "quote_requests", quote_id)
        if row["status"] == "deleted":
            raise HTTPException(404, "Quote not found")
        return _quote(row)


@router.put("/quote-requests/{quote_id}")
def update_quote(quote_id: UUID, body: QuoteWrite, request: Request,
                 principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        previous = _row(connection, "quote_requests", quote_id)
        if previous["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Quote owner required")
        if previous["status"] == "deleted":
            raise HTTPException(409, "Quote was deleted")
        _category(connection, body.categoryCode)
        if body.mode == "onsite" and not body.regionName:
            raise HTTPException(422, "Region is required for onsite quotes")
        connection.execute(text("""
            UPDATE quote_requests SET category_code=:category,title=:title,description=:description,
              service_mode=:mode,region_name=:region,budget_max=:budget,updated_at=now()
            WHERE id=:id
        """), {"id": quote_id, "category": body.categoryCode, "title": body.title.strip(),
               "description": body.description.strip(), "mode": body.mode,
               "region": body.regionName, "budget": body.budgetMax})
        return _quote(_row(connection, "quote_requests", quote_id))


@router.post("/quote-requests/{quote_id}/close")
def close_quote(quote_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        quote = _row(connection, "quote_requests", quote_id)
        if quote["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Quote owner required")
        if quote["status"] == "deleted":
            raise HTTPException(409, "Quote was deleted")
        connection.execute(text("UPDATE quote_requests SET status='closed',updated_at=now() WHERE id=:id"),
                           {"id": quote_id})
        return _quote(_row(connection, "quote_requests", quote_id))


@router.delete("/quote-requests/{quote_id}", status_code=204)
def delete_quote(quote_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        previous = _row(connection, "quote_requests", quote_id)
        if previous["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Quote owner required")
        connection.execute(text("UPDATE quote_requests SET status='deleted',updated_at=now() WHERE id=:id"),
                           {"id": quote_id})


@router.post("/quote-requests/{quote_id}/proposals", status_code=201)
def propose(quote_id: UUID, body: ProposalWrite, request: Request,
            principal: dict = Depends(identity)):
    with request.app.state.db.begin() as connection:
        quote = _row(connection, "quote_requests", quote_id)
        service = _row(connection, "services", body.serviceId)
        if quote["status"] != "open":
            raise HTTPException(409, "Quote is closed")
        if quote["owner_user_id"] == principal["user_id"]:
            raise HTTPException(403, "Cannot propose to your own quote")
        if service["owner_user_id"] != principal["user_id"] or service["status"] != "active":
            raise HTTPException(403, "Active own service required")
        if service["category_code"] != quote["category_code"]:
            raise HTTPException(422, "Service category does not match quote")
        previous = connection.execute(text("""
            SELECT id, room_id FROM proposals WHERE quote_request_id=:quote AND expert_user_id=:expert
        """), {"quote": quote_id, "expert": principal["user_id"]}).mappings().first()
        if previous:
            return {"proposalId": str(previous["id"]), "chatRoomId": str(previous["room_id"]),
                    "created": False}
        room_id = _open_room(connection, "quote_request", quote_id,
                             quote["owner_user_id"], principal["user_id"], quote["title"])
        proposal_id = uuid4()
        connection.execute(text("""
            INSERT INTO proposals(id, quote_request_id, expert_user_id, service_id, room_id)
            VALUES (:id,:quote,:expert,:service,:room)
        """), {"id": proposal_id, "quote": quote_id, "expert": principal["user_id"],
               "service": body.serviceId, "room": room_id})
        # Opening messages use the independent chat API after this transaction.
        return {"proposalId": str(proposal_id), "chatRoomId": str(room_id), "created": True}


@router.get("/quote-requests/{quote_id}/proposals")
def received_proposals(quote_id: UUID, request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        quote = _row(connection, "quote_requests", quote_id)
        if quote["owner_user_id"] != principal["user_id"]:
            raise HTTPException(403, "Quote owner required")
        rows = connection.execute(text("""
            SELECT p.id, p.service_id, p.room_id, p.expert_user_id, p.created_at,
                   s.title AS service_title
            FROM proposals p JOIN services s ON s.id=p.service_id
            WHERE p.quote_request_id=:quote ORDER BY p.created_at DESC
        """), {"quote": quote_id}).mappings().all()
        return {"items": [{"id": str(r["id"]), "serviceId": str(r["service_id"]),
                           "serviceTitle": r["service_title"], "chatRoomId": str(r["room_id"]),
                           "expertUserId": r["expert_user_id"], "createdAt": r["created_at"]}
                          for r in rows]}


@router.get("/me/proposals")
def sent_proposals(request: Request, principal: dict = Depends(identity)):
    with request.app.state.db.connect() as connection:
        rows = connection.execute(text("""
            SELECT p.id,p.quote_request_id,p.service_id,p.room_id,p.created_at,q.title AS quote_title
            FROM proposals p JOIN quote_requests q ON q.id=p.quote_request_id
            WHERE p.expert_user_id=:expert ORDER BY p.created_at DESC LIMIT 50
        """), {"expert": principal["user_id"]}).mappings().all()
        return {"items": [{"id": str(r["id"]), "quoteRequestId": str(r["quote_request_id"]),
                           "quoteTitle": r["quote_title"], "serviceId": str(r["service_id"]),
                           "chatRoomId": str(r["room_id"]), "createdAt": r["created_at"]}
                          for r in rows]}
