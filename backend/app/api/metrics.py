"""指标接口：成本看板的数据源。

没有这些数字，简历里就写不出「单次成本 $0.0031、延迟下降 61%」。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.models import Message, Ticket
from app.db.session import get_db
from app.schemas import MetricsSummary

router = APIRouter(tags=["metrics"], dependencies=[Depends(get_current_user)])


@router.get("/metrics/summary", response_model=MetricsSummary)
def summary(db: Session = Depends(get_db)):
    agg = db.query(
        func.count(Message.id),
        func.coalesce(func.sum(Message.cost_usd), 0),
        func.coalesce(func.avg(Message.latency_ms), 0),
        func.coalesce(func.avg(Message.prompt_tokens), 0),
    ).filter(Message.role == "assistant").one()

    tickets_total = db.query(func.count(Ticket.id)).scalar() or 0
    tickets_human = (
        db.query(func.count(Ticket.id)).filter(Ticket.needs_human.is_(True)).scalar() or 0
    )

    return MetricsSummary(
        total_messages=agg[0] or 0,
        total_cost_usd=round(float(agg[1] or 0), 6),
        avg_latency_ms=round(float(agg[2] or 0), 1),
        avg_prompt_tokens=round(float(agg[3] or 0), 1),
        tickets_total=tickets_total,
        tickets_needs_human=tickets_human,
    )
