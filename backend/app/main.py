"""应用入口。路由保持薄，业务在 services 里。"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, chat, documents, metrics, tickets, traces
from app.core.config import settings
from app.db.seed import seed_users
from app.db.session import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_users()
    logger.info("db ready: %s", settings.database_url)
    if not settings.tracing_enabled:
        logger.info("Langfuse tracing disabled (no keys) - 第 3 周记得配")
    yield


app = FastAPI(
    title="kb-agent",
    version="0.1.0",
    description="知识库问答 + 工单分流",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(documents.router, prefix=API_PREFIX)
app.include_router(chat.router, prefix=API_PREFIX)
app.include_router(tickets.router, prefix=API_PREFIX)
app.include_router(metrics.router, prefix=API_PREFIX)
app.include_router(traces.router, prefix=API_PREFIX)


@app.get("/health")
def health() -> dict:
    from app.core.llm import is_mock

    return {
        "status": "ok",
        "llm_mode": "mock" if is_mock() else "live",
        "model_fast": settings.model_fast,
        "model_smart": settings.model_smart,
        # 自建 trace 默认开启，落在业务库的 traces/spans 两张表
        "trace_store": "sqlite",
        "langfuse": settings.tracing_enabled,
        "retrieval": {
            "embed_provider": settings.embed_provider,
            "embed_model": settings.embed_model,
            "qdrant_mode": settings.qdrant_mode,
        },
    }
