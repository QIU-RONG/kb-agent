"""会话历史：列表、消息、重命名、删除。

所有接口都按 user_id 隔离——会话里存着完整的问答内容，
不隔离的话等于把别人的提问和答案直接摊开。
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.models import Conversation, Message, User
from app.db.session import get_db
from app.schemas import Citation, ConversationOut, MessageOut

logger = logging.getLogger(__name__)
router = APIRouter(tags=["conversations"])


class RenameRequest(BaseModel):
    title: str


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    rows = (
        db.query(
            Conversation,
            func.count(Message.id).label("cnt"),
            func.max(Message.created_at).label("last_at"),
        )
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .filter(Conversation.user_id == user.id)
        .group_by(Conversation.id)
        .order_by(func.max(Message.created_at).desc())
        .limit(60)
        .all()
    )

    return [
        ConversationOut(
            id=conv.id,
            title=conv.title,
            message_count=count,
            last_at=last_at or conv.created_at,
            preview=None,
        )
        for conv, count, last_at in rows
    ]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _own(db, conversation_id, user)
    rows = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at)
        .all()
    )
    return [_msg_out(m) for m in rows]


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: str,
    payload: RenameRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _own(db, conversation_id, user)
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "标题不能为空")

    conv.title = title[:80]
    db.commit()
    count = db.query(func.count(Message.id)).filter(Message.conversation_id == conv.id).scalar()
    return ConversationOut(
        id=conv.id, title=conv.title, message_count=count or 0, last_at=conv.created_at
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _own(db, conversation_id, user)
    db.delete(conv)  # cascade 带走 messages
    db.commit()
    return None


def _own(db: Session, conversation_id: str, user: User) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise HTTPException(404, "会话不存在")
    if conv.user_id not in (None, user.id):
        raise HTTPException(403, "无权访问该会话")
    if conv.user_id is None:
        conv.user_id = user.id
        db.commit()
    return conv


def _msg_out(m: Message) -> MessageOut:
    citations: list[Citation] = []
    if m.citations:
        try:
            raw = json.loads(m.citations)
            citations = [Citation(**c) for c in raw]
        except (json.JSONDecodeError, TypeError, ValueError):
            citations = []
    return MessageOut(
        id=m.id,
        role=m.role,
        content=m.content,
        citations=citations,
        created_at=m.created_at,
    )
