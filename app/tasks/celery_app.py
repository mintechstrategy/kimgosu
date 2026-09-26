import os
from pathlib import Path

from sqlalchemy import create_engine, text

from app.settings import database_url

from celery import Celery

celery_app = Celery("kimgosu", broker=os.environ["CELERY_BROKER_URL"])
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "delete-unsent-chat-attachments": {
            "task": "kimgosu.chat.remove_unsent_attachments",
            "schedule": 3600.0,
        },
    },
)


@celery_app.task(name="kimgosu.ping")
def ping():
    return "pong"


@celery_app.task(name="kimgosu.chat.remove_unsent_attachments")
def remove_unsent_attachments():
    """Discard files that were uploaded but never linked to a message."""
    engine = create_engine(database_url())
    try:
        with engine.begin() as connection:
            ids = connection.execute(text("""
                DELETE FROM chat_attachments
                WHERE message_id IS NULL AND created_at < now() - interval '24 hours'
                RETURNING id
            """)).scalars().all()
        directory = Path(os.environ["UPLOAD_DIR"]) / "chat"
        for attachment_id in ids:
            (directory / str(attachment_id)).unlink(missing_ok=True)
        return len(ids)
    finally:
        engine.dispose()
