"""数据库会话。开发用 sqlite，部署切 postgres 只需改 DATABASE_URL。"""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.models import Base

_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """开发期建表 + 极简迁移。生产请改用 alembic。"""
    Base.metadata.create_all(bind=engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """SQLite 没有 ADD COLUMN IF NOT EXISTS，手动检查后补列。

    这不是正式迁移方案，只是为了不让已有的本地数据因为加字段而作废。
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "documents" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("documents")}
    if "visibility" not in columns:
        with engine.begin() as conn:
            conn.execute(
                text("ALTER TABLE documents ADD COLUMN visibility VARCHAR(16) DEFAULT 'public'")
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_documents_visibility ON documents (visibility)"))

    if "conversations" in inspector.get_table_names():
        ccols = {c["name"] for c in inspector.get_columns("conversations")}
        if "user_id" not in ccols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE conversations ADD COLUMN user_id VARCHAR(32)"))
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS ix_conversations_user_id ON conversations (user_id)")
                )

    if "traces" in inspector.get_table_names():
        tcols = {c["name"] for c in inspector.get_columns("traces")}
        if "user_id" not in tcols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE traces ADD COLUMN user_id VARCHAR(32)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_traces_user_id ON traces (user_id)"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
