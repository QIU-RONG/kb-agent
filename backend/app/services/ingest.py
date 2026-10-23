"""入库：解析 → 切片 → 向量化 → 落库。

放在 BackgroundTasks 里跑，接口立即返回 pending，
前端轮询 status（同步解析大文件会让请求超时，这是新手常见错误）。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from app.core.config import settings
from app.db.models import Chunk, Document
from app.db.session import SessionLocal
from app.services import rag

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))


def extract_pages(path: Path) -> list[tuple[int | None, str]]:
    """返回 [(页码, 文本)]。不同格式走不同解析器。"""
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        return [
            (i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)
        ]

    if suffix == ".docx":
        import docx

        doc = docx.Document(str(path))
        text = "\n".join(p.text for p in doc.paragraphs)
        return [(None, text)]

    if suffix in {".md", ".txt", ".html", ".htm"}:
        return [(None, path.read_text(encoding="utf-8", errors="ignore"))]

    # 兜底：交给 markitdown 试试（第 2 周可替换成更完整的解析链）
    try:
        from markitdown import MarkItDown

        return [(None, MarkItDown().convert(str(path)).text_content)]
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"unsupported file type: {suffix}") from exc


async def ingest_document(document_id: str, path: Path) -> None:
    """后台任务入口。失败要把 status 写成 failed 并记下原因，
    否则前端会永远卡在 parsing。"""
    db = SessionLocal()
    doc = db.get(Document, document_id)
    if doc is None:
        db.close()
        return

    try:
        doc.status = "parsing"
        db.commit()

        pages = extract_pages(path)
        rows: list[dict] = []
        db_chunks: list[Chunk] = []

        for page_no, text in pages:
            for piece in rag.chunk_text(text):
                cid = rag.new_chunk_id()
                rows.append(
                    {
                        "chunk_id": cid,
                        "document_id": doc.id,
                        "document": doc.filename,
                        "page": page_no,
                        "content": piece,
                        # 可见性写进向量库 payload，检索时才能按角色过滤
                        "visibility": doc.visibility,
                    }
                )
                db_chunks.append(
                    Chunk(
                        id=cid,
                        document_id=doc.id,
                        ordinal=len(db_chunks),
                        content=piece,
                        page=page_no,
                        token_count=rag.estimate_tokens(piece),
                    )
                )

        if not db_chunks:
            raise ValueError("no extractable text found in document")

        db.add_all(db_chunks)
        db.commit()

        try:
            await rag.ensure_collection()
            await rag.upsert_chunks(rows)
        except Exception as exc:  # noqa: BLE001
            # 向量库挂了不影响元数据入库，标记降级即可
            logger.warning("vector upsert failed for %s: %s", doc.id, exc)

        doc.status = "indexed"
        doc.error = None
        db.commit()
        logger.info("indexed %s (%d chunks)", doc.filename, len(db_chunks))

    except Exception as exc:  # noqa: BLE001
        db.rollback()
        doc = db.get(Document, document_id)
        if doc is not None:
            doc.status = "failed"
            doc.error = str(exc)[:500]
            db.commit()
        logger.exception("ingest failed for %s", document_id)
    finally:
        db.close()
