"""检索层：切片、向量化、召回。

支持三种 embedding 供应商（`EMBED_PROVIDER`）：
- fastembed：本地 ONNX 模型，不需要 key、不出网（首次下载模型），默认
- openai：走 API，需要 OPENAI_API_KEY
- ollama：本地服务

向量库支持两种模式（`QDRANT_MODE`）：
- local：嵌入式，数据落在本地目录，不需要 Docker，默认
- server：连 Qdrant 服务

降级链：向量召回失败/为空 → 关键词召回。两者分数不同量纲，判分阈值分开。
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from dataclasses import dataclass

import litellm

from app.core.config import settings
from app.core.llm import is_mock

logger = logging.getLogger(__name__)

EMBED_PROVIDER = settings.embed_provider
EMBED_MODEL = settings.embed_model
VECTOR_SIZE = settings.embed_dim


@dataclass
class Hit:
    chunk_id: str
    document_id: str
    document: str
    page: int | None
    content: str
    score: float
    # vector = 余弦相似度；keyword = 2-gram 命中率。
    # 两者量纲不同，判分阈值必须分开，否则关键词召回会被系统性低估。
    source: str = "vector"
    visibility: str = "public"


@dataclass
class SearchResult:
    """检索结果 + 因权限被挡掉的条数（写进 trace，方便排查越权）"""

    hits: list[Hit]
    denied: int = 0


# ---------------- 分词与 mock ----------------

def _terms(text: str) -> list[str]:
    """极简分词：中文取 2-gram，英文取单词。够用且零依赖。"""
    text = text.lower()
    grams: list[str] = []
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        if len(run) == 1:
            grams.append(run)
        else:
            grams.extend(run[i : i + 2] for i in range(len(run) - 1))
    grams.extend(re.findall(r"[a-z0-9]{2,}", text))
    return grams


def _mock_vector(text: str, dim: int = VECTOR_SIZE) -> list[float]:
    import hashlib
    import math

    vec = [0.0] * dim
    for term in _terms(text):
        h = int(hashlib.md5(term.encode("utf-8")).hexdigest()[:8], 16)
        vec[h % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


# ---------------- embedding ----------------

_FE = None


def _get_fastembed():
    """模型加载要几秒，进程内缓存一份。"""
    global _FE
    if _FE is None:
        from fastembed import TextEmbedding

        _FE = TextEmbedding(model_name=EMBED_MODEL)
        logger.info("fastembed loaded: %s (dim=%d)", EMBED_MODEL, VECTOR_SIZE)
    return _FE


def _fastembed_encode(texts: list[str]) -> list[list[float]]:
    return [vec.tolist() for vec in _get_fastembed().embed(texts)]


def _embedding_available() -> bool:
    """当前 provider 能不能用。没有就别硬调——每次白等一次超时，日志还会刷满。"""
    if is_mock():
        return True
    if EMBED_PROVIDER == "fastembed":
        return True  # 本地模型，不需要 key
    if EMBED_PROVIDER == "openai":
        return bool(settings.openai_api_key or os.getenv("OPENAI_API_KEY"))
    if EMBED_PROVIDER == "ollama":
        return True
    return True


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if is_mock():
        return [_mock_vector(t) for t in texts]

    if EMBED_PROVIDER == "fastembed":
        # ONNX 推理是 CPU 密集的同步调用，丢到线程池，别阻塞事件循环
        return await asyncio.to_thread(_fastembed_encode, texts)

    resp = await litellm.aembedding(model=EMBED_MODEL, input=texts)
    return [item["embedding"] for item in resp.data]


# ---------------- 切片 ----------------

def chunk_text(text: str, size: int | None = None, overlap: int | None = None) -> list[str]:
    """按字符切片，带重叠。

    真实项目里这是效果好坏的第一决定因素，值得单独做实验：
    - 按段落/标题切（语义完整）通常优于按固定长度切
    - 表格要整块保留，不要切断
    - overlap 太小会丢上下文，太大则召回噪声多
    """
    size = size or settings.chunk_size
    overlap = overlap or settings.chunk_overlap
    if size <= 0:
        raise ValueError("chunk size must be positive")
    overlap = max(0, min(overlap, size - 1))

    text = (text or "").strip()
    if not text:
        return []

    chunks: list[str] = []
    step = size - overlap
    for start in range(0, len(text), step):
        piece = text[start : start + size].strip()
        if piece:
            chunks.append(piece)
        if start + size >= len(text):
            break
    return chunks


def estimate_tokens(text: str) -> int:
    """粗略估算：中文约 1.5 字/token，英文约 4 字符/token。
    第 3 周换成 tiktoken 精确计数。"""
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    other = len(text) - cjk
    return int(cjk / 1.5 + other / 4) or 1


# ---------------- 向量库 ----------------

_CLIENT = None


def _get_client():
    """单例。

    local 模式下 qdrant 会对目录加文件锁，多个 client 同时开会冲突，
    所以整个进程共用一个，且不主动 close。
    """
    global _CLIENT
    if _CLIENT is None:
        from qdrant_client import AsyncQdrantClient

        if settings.qdrant_mode == "local":
            _CLIENT = AsyncQdrantClient(path=settings.qdrant_path)
            logger.info("qdrant local mode: %s", settings.qdrant_path)
        else:
            _CLIENT = AsyncQdrantClient(url=settings.qdrant_url, timeout=10)
            logger.info("qdrant server mode: %s", settings.qdrant_url)
    return _CLIENT


async def ensure_collection() -> None:
    from qdrant_client.models import Distance, VectorParams

    client = _get_client()
    if not await client.collection_exists(settings.qdrant_collection):
        await client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        logger.info(
            "created collection %s (dim=%d)", settings.qdrant_collection, VECTOR_SIZE
        )


async def upsert_chunks(rows: list[dict]) -> None:
    """rows: [{chunk_id, document_id, document, page, content}]"""
    from qdrant_client.models import PointStruct

    if not rows:
        return
    vectors = await embed_texts([r["content"] for r in rows])
    points = [
        PointStruct(
            id=r["chunk_id"],
            vector=vec,
            payload={
                "document_id": r["document_id"],
                "document": r["document"],
                "page": r.get("page"),
                "content": r["content"],
                "visibility": r.get("visibility", "public"),
            },
        )
        for r, vec in zip(rows, vectors)
    ]
    await _get_client().upsert(collection_name=settings.qdrant_collection, points=points)


async def delete_document(document_id: str) -> None:
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    await _get_client().delete(
        collection_name=settings.qdrant_collection,
        points_selector=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
        ),
    )


async def search(
    query: str,
    top_k: int | None = None,
    scopes: list[str] | None = None,
) -> SearchResult:
    """向量召回，失败或为空时降级到关键词召回。

    scopes 是当前用户能看到的文档可见性白名单（见 core/security.py）。
    过滤在这里做，而不是在生成阶段——否则敏感内容已经进了 prompt。
    """
    top_k = top_k or settings.retrieve_top_k

    if not _embedding_available():
        return await keyword_search(query, top_k, scopes)

    try:
        vector = (await embed_texts([query]))[0]
        res = await _get_client().query_points(
            collection_name=settings.qdrant_collection,
            query=vector,
            limit=top_k * 3,
            with_payload=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("vector search unavailable, falling back to keywords: %s", exc)
        return await keyword_search(query, top_k, scopes)

    hits: list[Hit] = []
    denied = 0
    for point in res.points:
        p = point.payload or {}
        visibility = p.get("visibility", "public")
        if scopes is not None and visibility not in scopes:
            denied += 1
            continue
        if len(hits) >= top_k:
            continue
        hits.append(
            Hit(
                chunk_id=str(point.id),
                document_id=p.get("document_id", ""),
                document=p.get("document", ""),
                page=p.get("page"),
                content=p.get("content", ""),
                score=float(point.score),
                source="vector",
                visibility=visibility,
            )
        )

    if not hits:
        fallback = await keyword_search(query, top_k, scopes)
        return SearchResult(hits=fallback.hits, denied=denied + fallback.denied)
    return SearchResult(hits=hits, denied=denied)


async def keyword_search(
    query: str, top_k: int = 8, scopes: list[str] | None = None
) -> SearchResult:
    """关键词召回：2-gram 命中率打分。

    这是混合检索的基础件，也是向量库不可用时的兜底。
    规模上去（>10 万切片）要换成数据库 FTS 或 BM25 实现。
    """
    from sqlalchemy import or_

    from app.db.models import Chunk, Document
    from app.db.session import SessionLocal

    terms = _terms(query)
    if not terms:
        return SearchResult(hits=[])

    db = SessionLocal()
    try:
        filters = [Chunk.content.ilike(f"%{t}%") for t in terms[:8]]
        # 连表一次取到文件名和可见性，避免 session 关闭后再触发懒加载
        rows = (
            db.query(Chunk, Document.filename, Document.visibility)
            .join(Document, Chunk.document_id == Document.id)
            .filter(or_(*filters))
            .limit(500)
            .all()
        )
    finally:
        db.close()

    if not rows:
        return SearchResult(hits=[])

    total = len(terms)
    scored: list[Hit] = []
    denied = 0
    for chunk, filename, visibility in rows:
        content = chunk.content or ""
        matched = sum(1 for t in terms if t in content)
        score = matched / total
        if score <= 0:
            continue
        if scopes is not None and visibility not in scopes:
            denied += 1
            continue
        # 完整查询串命中时加权，避免被零散 2-gram 命中淹没
        if query in content:
            score = min(1.0, score + 0.25)
        scored.append(
            Hit(
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                document=filename,
                page=chunk.page,
                content=content,
                score=round(score, 4),
                source="keyword",
                visibility=visibility,
            )
        )

    scored.sort(key=lambda h: h.score, reverse=True)
    return SearchResult(hits=scored[:top_k], denied=denied)


def new_chunk_id() -> str:
    return uuid.uuid4().hex
