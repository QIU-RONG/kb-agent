"""问答流程编排（LangGraph）。

图结构：

    START → rewrite → retrieve → grade ─┬─(有命中)→ generate → END
                                        └─(无命中)→ fallback → END

为什么用图而不是 if-else：
1. 每个节点是独立可测的单元（改写、召回、判分、生成各自有输入输出）
2. 后续要加「置信度低转人工」「多轮追问」时，加节点比改嵌套分支清晰
3. 状态显式流转，出问题能定位到具体节点

注意：节点通过 state["emit"] 把增量事件推给 SSE 层，
所以图本身不关心怎么传输，测试时可以传一个收集器进来。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, TypedDict

from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.core.llm import Usage, complete_text, is_mock, stream_chat
from app.services import rag

logger = logging.getLogger(__name__)

Emit = Callable[[str, dict], Awaitable[None]]

# 图执行完毕（或异常）时推给传输层的终止信号
END_EVENT = "__end__"

SYSTEM_PROMPT = """你是内部知识库助手。请严格基于【参考资料】回答问题。

规则：
1. 资料里有答案就简明作答，并在句末标注来源序号，如 [1]。
2. 资料里没有相关信息，直接说「知识库中没有找到相关内容」，不要编造。
3. 不要引用参考资料之外的任何知识。
4. 回答控制在 200 字以内，条理清楚。"""

NO_HIT_ANSWER = (
    "知识库中没有找到相关内容。你可以：\n"
    "① 换一种说法再问一次；② 上传相关文档后再问；③ 提交工单由人工处理。"
)

# 阈值来自实测（见 config.py 注释）：向量相似度和 2-gram 命中率量纲不同，
# 必须分开配置。换 embedding 模型后这两个数都要重新标定。
SCORE_THRESHOLD = settings.vector_score_threshold
KEYWORD_SCORE_THRESHOLD = settings.keyword_score_threshold


async def _llm_relevant(question: str, content: str) -> bool:
    """灰色地带的相关性判断。

    失败时保守放行：宁可多给模型一段资料（它能自己忽略），
    也别把真问题判成"找不到"——后者对用户是硬伤。
    """
    if is_mock():
        return True
    try:
        answer = await complete_text(
            [
                {
                    "role": "system",
                    "content": (
                        "你是检索结果判别器。判断【资料】里是否包含回答【问题】所需的信息。"
                        "只输出「是」或「否」，不要解释。"
                    ),
                },
                {"role": "user", "content": f"【问题】{question}\n\n【资料】{content[:800]}"},
            ],
            tier="fast",
            max_tokens=4,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("relevance grading failed, keep by default: %s", exc)
        return True
    return answer.strip().startswith("是")


class QAState(TypedDict, total=False):
    question: str
    history: list[dict]
    query: str
    hits: list
    answer: str
    usage: Usage
    emit: Emit
    tracer: Any


# ---------------- 节点 ----------------

async def _rewrite(state: QAState) -> dict:
    """查询改写：把口语化问题改成更适合检索的形式。

    成本控制：短问题（≤30 字）本身检索效果就不差，跳过改写省一次调用。
    """
    question = state["question"]
    tracer = state["tracer"]

    async with tracer.span("rewrite", question=question) as s:
        if len(question) <= 30:
            s["skipped"] = True
            s["reason"] = "问题较短，直接用原句检索"
            return {"query": question}

        try:
            query = await complete_text(
                [
                    {
                        "role": "system",
                        "content": "把用户问题改写成适合向量检索的短查询，只输出查询本身，不要解释。",
                    },
                    {"role": "user", "content": question},
                ],
                tier="fast",
                max_tokens=64,
            )
            query = query.strip() or question
            s["query"] = query
            return {"query": query}
        except Exception as exc:  # noqa: BLE001
            logger.warning("rewrite failed, using original: %s", exc)
            s["fallback_to_original"] = True
            return {"query": question}


async def _retrieve(state: QAState) -> dict:
    tracer = state["tracer"]
    async with tracer.span("retrieve", query=state["query"]) as s:
        hits = await rag.search(state["query"])
        s["raw_hits"] = len(hits)
        s["source"] = hits[0].source if hits else None
        # 把每条候选的得分记下来，这是调阈值的唯一依据
        s["candidates"] = [
            {"chunk": h.chunk_id[:8], "score": round(h.score, 4), "source": h.source}
            for h in hits[:5]
        ]
        return {"hits": hits}


async def _grade(state: QAState) -> dict:
    """判分 + 截断 + 推送引用事件。

    两段式过滤（实测结论，见 config.py 注释）：
    - 相似度 >= 0.60：直接判相关
    - 相似度 <  0.35：直接判无关
    - 中间灰色地带：让模型判断一次"这段资料能不能回答问题"
      （只判 top-1，成本约 100 token，但能救回"一线城市住宿标准"
       这种恰好卡在 0.50 附近的真问题）

    这一步决定后面走 generate 还是 fallback，
    是整个防幻觉设计里最关键的一环。
    """
    emit = state["emit"]
    tracer = state["tracer"]
    question = state["question"]
    raw_hits = state.get("hits") or []

    kept: list = []
    graded_by_llm = False
    verdicts: list[dict] = []

    async with tracer.span("grade", candidates=len(raw_hits)) as s:
        for hit in raw_hits:
            if len(kept) >= settings.rerank_top_n:
                break

            if getattr(hit, "source", "vector") == "keyword":
                ok = hit.score >= settings.keyword_score_threshold
                verdicts.append(
                    {"chunk": hit.chunk_id[:8], "score": round(hit.score, 4), "by": "keyword阈值", "keep": ok}
                )
                if ok:
                    kept.append(hit)
                continue

            if hit.score >= settings.vector_score_threshold:
                kept.append(hit)
                verdicts.append(
                    {"chunk": hit.chunk_id[:8], "score": round(hit.score, 4), "by": "阈值", "keep": True}
                )
                continue
            if hit.score < settings.vector_grade_floor:
                verdicts.append(
                    {"chunk": hit.chunk_id[:8], "score": round(hit.score, 4), "by": "低于下限", "keep": False}
                )
                continue

            # 灰色地带：只对第一个候选做一次 LLM 判断
            if not kept and not graded_by_llm:
                graded_by_llm = True
                ok = await _llm_relevant(question, hit.content)
                verdicts.append(
                    {"chunk": hit.chunk_id[:8], "score": round(hit.score, 4), "by": "LLM判分", "keep": ok}
                )
                if ok:
                    kept.append(hit)

        s["verdicts"] = verdicts
        s["kept"] = len(kept)
        s["llm_graded"] = graded_by_llm

    await emit(
        "retrieval",
        {
            "hits": len(kept),
            "top_score": round(kept[0].score, 4) if kept else 0.0,
            "source": kept[0].source if kept else None,
            "llm_graded": graded_by_llm,
            "threshold": KEYWORD_SCORE_THRESHOLD
            if kept and kept[0].source == "keyword"
            else SCORE_THRESHOLD,
        },
    )
    for h in kept:
        await emit(
            "citation",
            {
                "chunk_id": h.chunk_id,
                "document_id": h.document_id,
                "document": h.document,
                "page": h.page,
                "score": round(h.score, 4),
            },
        )
    return {"hits": kept}


def _route(state: QAState) -> str:
    return "generate" if state.get("hits") else "fallback"


async def _generate(state: QAState) -> dict:
    emit = state["emit"]
    tracer = state["tracer"]
    usage = Usage()
    messages = _build_messages(state["question"], state["hits"], state.get("history") or [])

    parts: list[str] = []
    async with tracer.span("generate", chunks=len(state["hits"])) as s:
        try:
            async for delta in stream_chat(messages, tier="smart", usage_out=usage):
                parts.append(delta)
                await emit("delta", {"text": delta})
        except asyncio.CancelledError:
            s["cancelled"] = True
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("generation failed")
            s["error"] = f"{type(exc).__name__}: {exc}"[:200]
            await emit("error", {"message": f"生成失败，请重试（{type(exc).__name__}）"})
            return {"answer": "".join(parts), "usage": usage}

        s["chars"] = sum(len(p) for p in parts)
        s["model"] = usage.model
        s["tokens"] = {"in": usage.prompt_tokens, "out": usage.completion_tokens}
        s["cost_usd"] = usage.cost_usd

    return {"answer": "".join(parts), "usage": usage}


async def _fallback(state: QAState) -> dict:
    """无召回：不调模型，直接给降级话术。

    这是整个项目最重要的一个判断——真实业务里
    "编一个看起来合理的答案" 比 "承认不知道" 代价高得多。
    """
    emit = state["emit"]
    tracer = state["tracer"]
    async with tracer.span("fallback", reason="无命中，跳过生成"):
        for ch in NO_HIT_ANSWER:
            await emit("delta", {"text": ch})
            await asyncio.sleep(0.008)
    return {"answer": NO_HIT_ANSWER, "usage": Usage(mocked=True)}


def _build_messages(question: str, hits: list, history: list[dict]) -> list[dict]:
    if hits:
        blocks = [
            f"[{i + 1}] 来源：{h.document}" + (f" 第 {h.page} 页" if h.page else "") + f"\n{h.content}"
            for i, h in enumerate(hits)
        ]
        context = "\n\n".join(blocks)
    else:
        context = "（无）"

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history[-6:]:  # 只带最近 6 条，避免上下文膨胀导致成本失控
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append(
        {"role": "user", "content": f"【参考资料】\n{context}\n\n【问题】\n{question}"}
    )
    return messages


# ---------------- 编译 ----------------

def build_graph():
    graph = StateGraph(QAState)
    graph.add_node("rewrite", _rewrite)
    graph.add_node("retrieve", _retrieve)
    graph.add_node("grade", _grade)
    graph.add_node("generate", _generate)
    graph.add_node("fallback", _fallback)

    graph.add_edge(START, "rewrite")
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("retrieve", "grade")
    graph.add_conditional_edges(
        "grade", _route, {"generate": "generate", "fallback": "fallback"}
    )
    graph.add_edge("generate", END)
    graph.add_edge("fallback", END)
    return graph.compile()


_GRAPH = build_graph()


async def run_qa(
    question: str,
    history: list[dict],
    emit: Emit,
    tracer: Any = None,
) -> dict[str, Any]:
    """执行一次问答，返回最终 state（含 answer / usage / hits）。

    finally 里推 END_EVENT：无论成功、异常还是被取消，
    消费端都能确定地退出循环，不会挂死。
    """
    if tracer is None:
        from app.core.tracing import NoopTracer

        tracer = NoopTracer()

    state: QAState = {
        "question": question,
        "history": history,
        "emit": emit,
        "tracer": tracer,
    }
    try:
        return await _GRAPH.ainvoke(state)
    finally:
        try:
            await emit(END_EVENT, {})
        except Exception:  # noqa: BLE001 - 队列可能已关闭
            pass
