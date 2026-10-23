"""问答接口：SSE 流式。

路由层只做三件事：会话管理、把图产出的事件转成 SSE、落库。
真正的流程控制在 services/graph.py 里。

事件顺序：retrieval → citation* → delta* → done
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from app.core.tracing import Tracer
from app.db.models import Conversation, Message
from app.db.session import SessionLocal
from app.schemas import ChatRequest
from app.services.graph import END_EVENT, run_qa

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    async def event_gen():
        # 流式响应的生命周期可能长于请求作用域，
        # 所以这里自己开 session，不用 Depends(get_db)。
        db = SessionLocal()
        try:
            conv = db.get(Conversation, req.conversation_id) if req.conversation_id else None
            if conv is None:
                conv = Conversation(title=req.message[:40])
                db.add(conv)
                db.commit()

            db.add(Message(conversation_id=conv.id, role="user", content=req.message))
            db.commit()

            history = [
                {"role": m.role, "content": m.content}
                for m in db.query(Message)
                .filter(Message.conversation_id == conv.id)
                .order_by(Message.created_at)
                .all()
            ][:-1]  # 去掉刚插入的这条，它会作为当前问题单独传

            # 图通过 emit 往队列推事件，这里边收边转发，
            # 这样图不需要知道 SSE 的存在，单测时可以换成收集器
            queue: asyncio.Queue = asyncio.Queue()

            async def emit(event: str, data: dict) -> None:
                await queue.put((event, data))

            tracer = Tracer(req.message)

            task = asyncio.create_task(run_qa(req.message, history, emit, tracer))

            try:
                while True:
                    event, data = await queue.get()
                    if event == END_EVENT:
                        break
                    yield {"event": event, "data": json.dumps(data, ensure_ascii=False)}

                final = await task
            except asyncio.CancelledError:
                # 用户中断：终止生成（省 token），已生成的部分照样落库
                logger.info("client disconnected, cancelling generation")
                task.cancel()
                raise

            usage = final.get("usage")
            hits = final.get("hits") or []
            answer = final.get("answer", "")

            # 先落 trace 再落消息：trace_id 要写进 messages 表，
            # 这样从一条回答能直接跳到它的完整链路
            trace_id = tracer.finish(
                answer,
                model=getattr(usage, "model", ""),
                hit_count=len(hits),
                fallback=not hits,
                tokens_in=getattr(usage, "prompt_tokens", 0),
                tokens_out=getattr(usage, "completion_tokens", 0),
                cost_usd=getattr(usage, "cost_usd", 0.0),
            )
            msg = _persist(db, conv.id, answer, hits, usage, trace_id)

            yield {
                "event": "done",
                "data": json.dumps(
                    {
                        "message_id": msg.id,
                        "conversation_id": conv.id,
                        "trace_id": trace_id,
                        "tokens": {
                            "in": getattr(usage, "prompt_tokens", 0),
                            "out": getattr(usage, "completion_tokens", 0),
                        },
                        "cost_usd": getattr(usage, "cost_usd", 0.0),
                        "latency_ms": getattr(usage, "latency_ms", 0),
                        "model": getattr(usage, "model", ""),
                        "mocked": getattr(usage, "mocked", False),
                        "fallback_used": getattr(usage, "fallback_used", False),
                        "citations": len(hits),
                    },
                    ensure_ascii=False,
                ),
            }
        finally:
            db.close()

    return EventSourceResponse(event_gen())


def _persist(db, conversation_id: str, content: str, hits: list, usage, trace_id: str = "") -> Message:
    msg = Message(
        conversation_id=conversation_id,
        role="assistant",
        content=content,
        citations=json.dumps(
            [
                {
                    "chunk_id": h.chunk_id,
                    "document_id": h.document_id,
                    "document": h.document,
                    "page": h.page,
                    "score": h.score,
                }
                for h in hits
            ],
            ensure_ascii=False,
        ),
        prompt_tokens=getattr(usage, "prompt_tokens", 0),
        completion_tokens=getattr(usage, "completion_tokens", 0),
        cost_usd=getattr(usage, "cost_usd", 0.0),
        latency_ms=getattr(usage, "latency_ms", 0),
        trace_id=trace_id or None,
    )
    db.add(msg)
    db.commit()
    return msg
