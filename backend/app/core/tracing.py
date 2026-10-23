"""轻量链路追踪。

为什么不用 Langfuse：它需要一套服务端（Postgres + Web + Docker），
这个项目的目标是"clone 下来就能跑"。所以先自己实现最小可用的 trace：
每一步的输入输出、耗时、状态都落到 SQLite，前端能直接看。

接口刻意做成和 OpenTelemetry 的 span 语义一致，
以后要换成 Langfuse/OTel 只需要替换 Tracer 实现，业务代码不用动。

用法：
    tracer = Tracer(question)
    async with tracer.span("retrieve") as s:
        hits = await search(...)
        s["hits"] = len(hits)
    tracer.finish(answer, model=..., cost_usd=...)
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

logger = logging.getLogger(__name__)


class Tracer:
    def __init__(self, question: str):
        self.id = uuid.uuid4().hex[:16]
        self.question = question
        self.answer = ""
        self.spans: list[dict[str, Any]] = []
        self.started = time.perf_counter()
        self._closed = False

    @asynccontextmanager
    async def span(self, name: str, **meta: Any):
        """记录一个步骤。异常也会被记下来（status=error），然后继续抛。"""
        t0 = time.perf_counter()
        payload: dict[str, Any] = dict(meta)
        status = "ok"
        try:
            yield payload
        except Exception as exc:  # noqa: BLE001
            status = "error"
            payload["error"] = f"{type(exc).__name__}: {exc}"[:300]
            raise
        finally:
            self.spans.append(
                {
                    "name": name,
                    "seq": len(self.spans),
                    "started_ms": int((t0 - self.started) * 1000),
                    "duration_ms": int((time.perf_counter() - t0) * 1000),
                    "status": status,
                    "data": payload,
                }
            )

    def finish(self, answer: str, **summary: Any) -> str:
        """落库。失败只记日志，绝不影响主流程——
        可观测性挂了不能把业务拖垮。"""
        self.answer = answer or ""
        if self._closed:
            return self.id
        self._closed = True

        try:
            from app.db.models import Span, Trace
            from app.db.session import SessionLocal

            db = SessionLocal()
            try:
                trace = Trace(
                    id=self.id,
                    question=self.question[:2000],
                    answer=self.answer[:4000],
                    model=summary.get("model") or None,
                    hit_count=int(summary.get("hit_count") or 0),
                    fallback=bool(summary.get("fallback")),
                    tokens_in=int(summary.get("tokens_in") or 0),
                    tokens_out=int(summary.get("tokens_out") or 0),
                    cost_usd=float(summary.get("cost_usd") or 0),
                    latency_ms=int((time.perf_counter() - self.started) * 1000),
                )
                db.add(trace)
                for s in self.spans:
                    db.add(
                        Span(
                            trace_id=self.id,
                            name=s["name"],
                            seq=s["seq"],
                            started_ms=s["started_ms"],
                            duration_ms=s["duration_ms"],
                            status=s["status"],
                            data_json=json.dumps(s["data"], ensure_ascii=False)[:4000],
                        )
                    )
                db.commit()
            finally:
                db.close()
        except Exception:  # noqa: BLE001
            logger.exception("trace persist failed (ignored)")

        return self.id


class NoopTracer:
    """不记录时的占位实现，让业务代码不用到处判空。"""

    id = ""

    @asynccontextmanager
    async def span(self, name: str, **meta: Any):
        yield {}

    def finish(self, answer: str, **summary: Any) -> str:
        return ""
