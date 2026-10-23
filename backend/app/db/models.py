"""数据模型。字段设计与 docs/spec.html 第 5 节保持一致。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return uuid.uuid4().hex[:16]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    """内部系统的用户。

    角色决定能检索到哪些文档（见 Document.visibility），
    不是只决定能不能登录——这一点比登录本身重要。
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    display_name: Mapped[str] = mapped_column(String(64), default="")
    # employee | hr | finance | admin
    role: Mapped[str] = mapped_column(String(16), default="employee", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(100), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    # pending | parsing | indexed | failed
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # public | hr | finance | admin —— 检索时按用户角色过滤，这是权限的核心
    visibility: Mapped[str] = mapped_column(String(16), default="public", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class Chunk(Base):
    __tablename__ = "chunks"

    # 与 Qdrant 的 point_id 保持一致，这是引用溯源能指对的前提
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    document: Mapped[Document] = relationship(back_populates="chunks")

    __table_args__ = (Index("idx_chunks_doc", "document_id", "ordinal"),)


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    priority: Mapped[str | None] = mapped_column(String(8), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    needs_human: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # 完整模型输出，badcase 复盘时非常有用
    raw_llm: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrected_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 会话归属。没有这个字段时，只要知道 conversation_id 就能续聊别人的会话
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    # [{chunk_id, document_id, page, score}]
    citations: Mapped[str | None] = mapped_column(Text, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Trace(Base):
    """一次问答的完整链路。定位 badcase 的第一现场。"""

    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default="")
    # 谁问的。trace 里存着完整回答，不隔离的话等于绕过检索层的权限
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    fallback: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    spans: Mapped[list["Span"]] = relationship(
        back_populates="trace", cascade="all, delete-orphan"
    )


class Span(Base):
    """链路中的一个步骤：rewrite / retrieve / grade / generate / fallback。"""

    __tablename__ = "spans"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    trace_id: Mapped[str] = mapped_column(
        ForeignKey("traces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(32))
    seq: Mapped[int] = mapped_column(Integer, default=0)
    started_ms: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    data_json: Mapped[str] = mapped_column(Text, default="{}")

    trace: Mapped[Trace] = relationship(back_populates="spans")

    __table_args__ = (Index("idx_spans_trace", "trace_id", "seq"),)
