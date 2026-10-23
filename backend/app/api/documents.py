"""文档接口：上传后立即返回 pending，解析走后台任务。"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import can_see, get_current_user, visible_scopes
from app.db.models import Chunk, Document, User
from app.db.session import get_db
from app.schemas import ChunkOut, DocumentOut
from app.services import rag
from app.services.ingest import UPLOAD_DIR, ingest_document

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

ALLOWED_SUFFIX = {".pdf", ".docx", ".md", ".txt", ".html", ".htm"}
ALLOWED_VISIBILITY = {"public", "hr", "finance", "admin"}
MAX_BYTES = 20 * 1024 * 1024


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    file: UploadFile,
    background: BackgroundTasks,
    visibility: str = Form("public"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIX:
        raise HTTPException(415, f"unsupported type {suffix}")

    if visibility not in ALLOWED_VISIBILITY:
        raise HTTPException(400, f"visibility 只能是 {', '.join(sorted(ALLOWED_VISIBILITY))}")

    # 只有 hr / finance / admin 能上传非公开文档；
    # 普通员工即使传了 visibility=hr 也会被降级成 public，防止越权上传后自己又看不到
    if visibility != "public" and user.role not in {"hr", "finance", "admin"}:
        raise HTTPException(403, "无权上传非公开文档")

    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "file too large (max 20MB)")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    stored.write_bytes(raw)

    doc = Document(
        filename=file.filename or stored.name,
        mime=file.content_type or "application/octet-stream",
        size_bytes=len(raw),
        status="pending",
        visibility=visibility,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 关键：不要同步解析，否则大文件会把请求拖到超时
    background.add_task(ingest_document, doc.id, stored)

    return _doc_out(doc, 0)


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    scopes = visible_scopes(user.role)
    docs = (
        db.query(Document)
        .filter(Document.visibility.in_(scopes))
        .order_by(Document.created_at.desc())
        .limit(200)
        .all()
    )
    counts = dict(
        db.query(Chunk.document_id, func.count(Chunk.id))
        .group_by(Chunk.document_id)
        .all()
    )
    return [_doc_out(d, counts.get(d.id, 0)) for d in docs]


@router.get("/chunks/{chunk_id}", response_model=ChunkOut)
def get_chunk(
    chunk_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """引用卡片展开时拿原文。

    这里必须再查一次权限：chunk_id 会出现在 trace 和引用里，
    不能因为"知道 id"就能读到内容。
    """
    row = (
        db.query(Chunk, Document.filename, Document.visibility)
        .join(Document, Chunk.document_id == Document.id)
        .filter(Chunk.id == chunk_id)
        .first()
    )
    if row is None:
        raise HTTPException(404, "chunk not found")

    chunk, filename, visibility = row
    if not can_see(user, visibility):
        raise HTTPException(403, "无权查看该文档片段")

    return ChunkOut(
        id=chunk.id,
        document_id=chunk.document_id,
        document=filename,
        page=chunk.page,
        ordinal=chunk.ordinal,
        content=chunk.content,
        token_count=chunk.token_count,
    )


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(404, "document not found")

    # 删除是不可逆操作，只给管理角色；普通员工连看都看不到的文档更不能删
    if user.role not in {"hr", "finance", "admin"} or not can_see(user, doc.visibility):
        raise HTTPException(403, "无权删除该文档")

    # 先删向量再删业务记录：向量删失败可以重试，
    # 反过来会造成「向量库有孤儿数据但业务表查不到」的不一致
    try:
        await rag.delete_document(document_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("vector delete failed (will leave orphan): %s", exc)

    db.delete(doc)  # cascade 会带走 chunks
    db.commit()
    return None


def _doc_out(doc: Document, chunk_count: int) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        filename=doc.filename,
        mime=doc.mime,
        size_bytes=doc.size_bytes,
        status=doc.status,
        visibility=doc.visibility,
        error=doc.error,
        chunk_count=chunk_count,
        created_at=doc.created_at,
    )
