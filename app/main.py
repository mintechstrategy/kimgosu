import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from redis import Redis
from sqlalchemy import create_engine, text

from app.settings import database_url


@asynccontextmanager
async def lifespan(app):
    app.state.db = create_engine(database_url(), pool_pre_ping=True, connect_args={"connect_timeout": 3})
    app.state.redis = Redis.from_url(os.environ["CHAT_REDIS_URL"], socket_connect_timeout=3, socket_timeout=3)
    yield
    app.state.redis.close()
    app.state.db.dispose()


app = FastAPI(title="Kimgosu API", version="0.1.0", lifespan=lifespan)


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
