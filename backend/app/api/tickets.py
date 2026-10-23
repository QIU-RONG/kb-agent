"""工单接口：提交即分流，低置信度转人工，支持人工纠正回流。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.models import Ticket
from app.db.session import get_db
from app.schemas import TicketCorrect, TicketCreate, TicketOut
from app.services.classify import classify_ticket, dump_raw

logger = logging.getLogger(__name__)
# 整个路由组统一要求登录，避免漏掉某个接口
router = APIRouter(tags=["tickets"], dependencies=[Depends(get_current_user)])


@router.post("/tickets", response_model=TicketOut, status_code=201)
async def create_ticket(payload: TicketCreate, db: Session = Depends(get_db)):
    ticket = Ticket(title=payload.title, body=payload.body)
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    try:
        result, needs_human = await classify_ticket(payload.title, payload.body)
        ticket.category = result.category
        ticket.priority = result.priority
        ticket.confidence = result.confidence
        ticket.needs_human = needs_human
        ticket.raw_llm = dump_raw(result)
    except Exception as exc:  # noqa: BLE001
        # 分流失败不能让工单丢失：标记待人工，保留错误信息
        logger.exception("classify failed")
        ticket.needs_human = True
        ticket.raw_llm = f'{{"error": "{type(exc).__name__}"}}'
    db.commit()
    db.refresh(ticket)
    return _out(ticket)


@router.get("/tickets", response_model=list[TicketOut])
def list_tickets(
    category: str | None = None,
    needs_human: bool | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(Ticket)
    if category:
        q = q.filter(Ticket.category == category)
    if needs_human is not None:
        q = q.filter(Ticket.needs_human == needs_human)
    rows = q.order_by(Ticket.created_at.desc()).offset(offset).limit(limit).all()
    return [_out(t) for t in rows]


@router.post("/tickets/{ticket_id}/correct", response_model=TicketOut)
def correct_ticket(ticket_id: str, payload: TicketCorrect, db: Session = Depends(get_db)):
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(404, "ticket not found")

    # 保留原分类在 raw_llm 里，纠正记录单独写字段：
    # 这批数据就是后续优化 prompt / 换模型的依据
    ticket.category = payload.category
    ticket.needs_human = False
    ticket.corrected_by = payload.corrected_by
    db.commit()
    db.refresh(ticket)
    return _out(ticket)


def _out(t: Ticket) -> TicketOut:
    return TicketOut(
        id=t.id,
        title=t.title,
        body=t.body,
        category=t.category,
        priority=t.priority,
        confidence=t.confidence,
        needs_human=t.needs_human,
        corrected_by=t.corrected_by,
        created_at=t.created_at,
    )
