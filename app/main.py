import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis import Redis
from sqlalchemy import create_engine, text

from app.settings import database_url
from app.chat.api import router as chat_router
from app.accounts.api import router as account_router
from app.catalog.api import router as catalog_router
from app.marketplace.api import router as marketplace_router
from app.marketplace.reviews import router as review_router
from app.support.api import router as support_router


@asynccontextmanager
async def lifespan(app):
    app.state.db = create_engine(database_url(), pool_pre_ping=True, connect_args={"connect_timeout": 3})
    app.state.redis = Redis.from_url(os.environ["CHAT_REDIS_URL"], socket_connect_timeout=3, socket_timeout=3)
    from redis.asyncio import Redis as AsyncRedis
    app.state.chat_events = AsyncRedis.from_url(os.environ["CHAT_REDIS_URL"], decode_responses=True)
    yield
    await app.state.chat_events.aclose()
    app.state.redis.close()
    app.state.db.dispose()


app = FastAPI(title="Kimgosu API", version="0.1.0", lifespan=lifespan)
origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                       allow_headers=["Authorization", "Content-Type"], allow_credentials=False)
app.include_router(chat_router, prefix="/api/v1/chat", tags=["chat"])
app.include_router(account_router, prefix="/api/v1", tags=["accounts"])
app.include_router(catalog_router, prefix="/api/v1/catalog", tags=["catalog"])
app.include_router(marketplace_router, prefix="/api/v1", tags=["marketplace"])
app.include_router(review_router, prefix="/api/v1", tags=["reviews"])
app.include_router(support_router, prefix="/api/v1", tags=["support"])


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready():
    try:
        with app.state.db.connect() as connection:
            connection.execute(text("SELECT 1"))
        app.state.redis.ping()
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    return {"status": "ready", "database": "ok", "redis": "ok"}
