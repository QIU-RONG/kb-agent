"""文档接口：上传后立即返回 pending，解析走后台任务。"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Chunk, Document
from app.db.session import get_db
from app.schemas import ChunkOut, DocumentOut
from app.services import rag
from app.services.ingest import UPLOAD_DIR, ingest_document

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

ALLOWED_SUFFIX = {".pdf", ".docx", ".md", ".txt", ".html", ".htm"}
MAX_BYTES = 20 * 1024 * 1024


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    file: UploadFile,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIX:
        raise HTTPException(415, f"unsupported type {suffix}")

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
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 关键：不要同步解析，否则大文件会把请求拖到超时
    background.add_task(ingest_document, doc.id, stored)

    return DocumentOut(
        id=doc.id,
        filename=doc.filename,
        mime=doc.mime,
        size_bytes=doc.size_bytes,
        status=doc.status,
        error=doc.error,
        chunk_count=0,
        created_at=doc.created_at,
    )


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).order_by(Document.created_at.desc()).limit(200).all()
    counts = dict(
        db.query(Chunk.document_id, func.count(Chunk.id))
        .group_by(Chunk.document_id)
        .all()
    )
    return [
        DocumentOut(
            id=d.id,
            filename=d.filename,
            mime=d.mime,
            size_bytes=d.size_bytes,
            status=d.status,
            error=d.error,
            chunk_count=counts.get(d.id, 0),
            created_at=d.created_at,
        )
        for d in docs
    ]


@router.get("/chunks/{chunk_id}", response_model=ChunkOut)
def get_chunk(chunk_id: str, db: Session = Depends(get_db)):
    """引用卡片展开时拿原文。

    只读、无副作用，前端可以放心缓存。
    """
    row = (
        db.query(Chunk, Document.filename)
        .join(Document, Chunk.document_id == Document.id)
        .filter(Chunk.id == chunk_id)
        .first()
    )
    if row is None:
        raise HTTPException(404, "chunk not found")

    chunk, filename = row
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
async def delete_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(404, "document not found")

    # 先删向量再删业务记录：向量删失败可以重试，
    # 反过来会造成「向量库有孤儿数据但业务表查不到」的不一致
    try:
        await rag.delete_document(document_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("vector delete failed (will leave orphan): %s", exc)

    db.delete(doc)  # cascade 会带走 chunks
    db.commit()
    return None
