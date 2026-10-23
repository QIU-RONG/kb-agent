"""请求 / 响应模型。前端 frontend/lib/api.ts 的类型要和这里对齐。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Category = Literal["billing", "account", "bug", "feature", "other"]
Priority = Literal["p0", "p1", "p2", "p3"]


# ---------- 鉴权 ----------
class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    role: str
    scopes: list[str] = []


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- 文档 ----------
class DocumentOut(BaseModel):
    id: str
    filename: str
    mime: str
    size_bytes: int
    status: str
    visibility: str = "public"
    error: str | None = None
    chunk_count: int = 0
    created_at: datetime


# ---------- 问答 ----------
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


class Citation(BaseModel):
    chunk_id: str
    document_id: str
    document: str
    page: int | None = None
    score: float


class ChunkOut(BaseModel):
    """引用卡片点开时用：拿到原文，用户才知道答案是从哪句话来的。"""

    id: str
    document_id: str
    document: str
    page: int | None = None
    ordinal: int = 0
    content: str
    token_count: int = 0


# ---------- 工单 ----------
class TicketCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1, max_length=8000)


class TicketOut(BaseModel):
    id: str
    title: str
    body: str
    category: str | None
    priority: str | None
    confidence: float | None
    needs_human: bool
    corrected_by: str | None = None
    created_at: datetime


class TicketCorrect(BaseModel):
    category: Category
    corrected_by: str = Field(default="human", max_length=32)


# ---------- 指标 ----------
class MetricsSummary(BaseModel):
    total_messages: int
    total_cost_usd: float
    avg_latency_ms: float
    avg_prompt_tokens: float
    tickets_total: int
    tickets_needs_human: int


# ---------- 链路追踪 ----------
class SpanOut(BaseModel):
    name: str
    seq: int
    started_ms: int
    duration_ms: int
    status: str
    data: dict


class TraceSummary(BaseModel):
    id: str
    question: str
    answer: str
    model: str | None
    hit_count: int
    fallback: bool
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int
    created_at: datetime


class TraceDetail(TraceSummary):
    spans: list[SpanOut]
