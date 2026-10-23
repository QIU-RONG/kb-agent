"""链路查询接口。

一次问答的每一步都在这里可查：改写后的 query、每条候选的得分、
判分结论（阈值 / LLM）、生成耗时和成本。

这就是"怎么定位一个 badcase"的答案：
先看 grade 的 verdicts，判断是召回问题还是生成问题。
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.models import Span, Trace, User
from app.db.session import get_db
from app.schemas import SpanOut, TraceDetail, TraceSummary

logger = logging.getLogger(__name__)
router = APIRouter(tags=["traces"], dependencies=[Depends(get_current_user)])


@router.get("/traces", response_model=list[TraceSummary])
def list_traces(
    limit: int = Query(30, le=200),
    fallback_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Trace)
    # trace 里存着完整回答，含敏感文档的内容。
    # 不按用户隔离的话，普通员工能看到 HR 问薪酬的答案——等于绕过检索层权限。
    if user.role != "admin":
        q = q.filter(Trace.user_id == user.id)
    if fallback_only:
        q = q.filter(Trace.fallback.is_(True))
    rows = q.order_by(Trace.created_at.desc()).limit(limit).all()
    return [_summary(t) for t in rows]


@router.get("/traces/{trace_id}", response_model=TraceDetail)
def get_trace(
    trace_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    trace = db.get(Trace, trace_id)
    if trace is None:
        raise HTTPException(404, "trace not found")
    if user.role != "admin" and trace.user_id != user.id:
        raise HTTPException(403, "无权查看他人的调用链路")

    spans = (
        db.query(Span).filter(Span.trace_id == trace_id).order_by(Span.seq).all()
    )
    base = _summary(trace)
    return TraceDetail(
        **base.model_dump(),
        spans=[
            SpanOut(
                name=s.name,
                seq=s.seq,
                started_ms=s.started_ms,
                duration_ms=s.duration_ms,
                status=s.status,
                data=_safe_json(s.data_json),
            )
            for s in spans
        ],
    )


def _safe_json(raw: str | None) -> dict:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}


def _summary(t: Trace) -> TraceSummary:
    return TraceSummary(
        id=t.id,
        question=t.question,
        answer=t.answer,
        model=t.model,
        hit_count=t.hit_count,
        fallback=t.fallback,
        tokens_in=t.tokens_in,
        tokens_out=t.tokens_out,
        cost_usd=float(t.cost_usd or 0),
        latency_ms=t.latency_ms,
        created_at=t.created_at,
    )
