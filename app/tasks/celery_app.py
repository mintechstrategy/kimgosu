import os

from celery import Celery

celery_app = Celery("kimgosu", broker=os.environ["CELERY_BROKER_URL"])
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    broker_connection_retry_on_startup=True,
)


@celery_app.task(name="kimgosu.ping")
def ping():
    return "pong"
