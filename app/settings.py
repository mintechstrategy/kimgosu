import os
from pathlib import Path

from sqlalchemy import URL


def database_url():
    return URL.create(
        "postgresql+psycopg",
        username=os.environ["DB_USER"],
        password=Path(os.environ["DB_PASSWORD_FILE"]).read_text().strip(),
        host=os.environ["DB_HOST"],
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.environ["DB_NAME"],
    )
