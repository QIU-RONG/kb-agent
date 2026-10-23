"""模型网关：全项目唯一允许调用 LLM 的地方。

职责：
1. 统一入口（业务代码不出现裸 openai/litellm 调用）
2. 档位路由（fast / smart）
3. 超时与 fallback（主模型失败自动切备用）
4. 用量与成本记账（写进 message 表，供成本看板使用）
5. mock 模式（没配 key 也能跑通整条链路，零成本）

面试可讲：为什么需要网关？因为换模型、控成本、查问题时，
如果调用散落在 20 个文件里，任何一件事都做不了。
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Literal

# 必须在 import litellm 之前设置。
# 否则 litellm 启动时会去 raw.githubusercontent.com 拉价格表，
# 网络不通时重试 3 次、白等 50 秒（实测）。本地自带的备份表够用。
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import litellm  # noqa: E402

from app.core.config import settings  # noqa: E402

logger = logging.getLogger(__name__)

Tier = Literal["fast", "smart"]

_KEY_ENVS = ("DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")


def _api_key_for(model: str) -> str | None:
    """按模型前缀取 key。返回 None 时 litellm 会自己回落到环境变量。"""
    if model.startswith("deepseek/"):
        return settings.deepseek_api_key or os.getenv("DEEPSEEK_API_KEY")
    if model.startswith("openai/"):
        return settings.openai_api_key or os.getenv("OPENAI_API_KEY")
    if model.startswith("anthropic/"):
        return settings.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
    return None


def _has_key() -> bool:
    return bool(
        settings.deepseek_api_key
        or settings.openai_api_key
        or settings.anthropic_api_key
        or any(os.getenv(k) for k in _KEY_ENVS)
    )


@dataclass
class Usage:
    """一次调用的用量快照。落到 messages 表里。"""

    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    fallback_used: bool = False
    mocked: bool = False
    extra: dict = field(default_factory=dict)


def is_mock() -> bool:
    """auto 模式下：没有 key 且不是本地 ollama，就走 mock。"""
    mode = (settings.llm_mode or "auto").lower()
    if mode == "mock":
        return True
    if mode == "live":
        return False
    if settings.model_smart.startswith("ollama/"):
        return False
    return not _has_key()


def _model_for(tier: Tier) -> str:
    return settings.model_smart if tier == "smart" else settings.model_fast


def _candidate_models(tier: Tier) -> list[str]:
    primary = _model_for(tier)
    return [primary] if settings.model_fallback == primary else [primary, settings.model_fallback]


# ---------------- mock ----------------

_MOCK_ANSWER = (
    "根据财务制度第 12 条，普通报销在提交后由部门负责人审批，"
    "财务复核通过一般在 5 个工作日内到账；差旅类报销因需核对票据，"
    "通常再延长 2 到 3 个工作日。如超过 10 个工作日未到账，建议提交工单查询。[1]"
)


async def _mock_stream(prompt_hint: str, usage_out: Usage | None) -> AsyncIterator[str]:
    """模拟流式输出：按 6 字一段吐，间隔 20ms。
    这样前端能真实看到"逐字出现"，验收标准和真模型一致。"""
    started = time.perf_counter()
    text = _MOCK_ANSWER
    step = 6
    for i in range(0, len(text), step):
        yield text[i : i + step]
        await asyncio.sleep(0.02)

    if usage_out is not None:
        usage_out.model = "mock/deterministic"
        usage_out.mocked = True
        usage_out.prompt_tokens = max(1, len(prompt_hint) // 3)
        usage_out.completion_tokens = len(text) // 2
        usage_out.cost_usd = 0.0
        usage_out.latency_ms = int((time.perf_counter() - started) * 1000)


# ---------------- 主入口 ----------------

async def stream_chat(
    messages: list[dict],
    tier: Tier = "smart",
    temperature: float = 0.2,
    usage_out: Usage | None = None,
) -> AsyncIterator[str]:
    """流式生成，逐段 yield 文本增量。"""
    if is_mock():
        hint = messages[-1]["content"] if messages else ""
        async for piece in _mock_stream(hint, usage_out):
            yield piece
        return

    started = time.perf_counter()
    last_error: Exception | None = None

    for idx, model in enumerate(_candidate_models(tier)):
        try:
            response = await litellm.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                stream=True,
                stream_options={"include_usage": True},
                timeout=settings.request_timeout,
                api_key=_api_key_for(model),
            )
            async for chunk in response:
                if getattr(chunk, "usage", None) and usage_out is not None:
                    usage_out.prompt_tokens = chunk.usage.prompt_tokens or 0
                    usage_out.completion_tokens = chunk.usage.completion_tokens or 0
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    yield delta

            if usage_out is not None:
                usage_out.model = model
                usage_out.fallback_used = idx > 0
                usage_out.latency_ms = int((time.perf_counter() - started) * 1000)
                usage_out.cost_usd = _estimate_cost(
                    model, usage_out.prompt_tokens, usage_out.completion_tokens
                )
            return

        except Exception as exc:  # noqa: BLE001 - 需要兜住所有上游异常
            last_error = exc
            logger.warning("model %s failed, trying next: %s", model, exc)

    raise RuntimeError(f"all models failed, last error: {last_error}") from last_error


async def complete_text(
    messages: list[dict],
    tier: Tier = "fast",
    max_tokens: int = 128,
    temperature: float = 0.0,
) -> str:
    """非流式短文本（改写查询、打分这类）。"""
    if is_mock():
        return messages[-1]["content"].strip()[:120]

    resp = await litellm.acompletion(
        model=_model_for(tier),
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=settings.request_timeout,
        api_key=_api_key_for(_model_for(tier)),
    )
    return (resp.choices[0].message.content or "").strip()


async def complete_json(
    messages: list[dict],
    response_model,
    tier: Tier = "fast",
    max_retries: int = 2,
):
    """结构化输出。用 instructor 把 Pydantic 模型当 schema 约束，
    校验失败会带着错误信息自动重试——这是比 prompt 约束可靠得多的做法。

    注意用 acompletion 而不是 completion：
    这是 async 上下文，同步 client 会阻塞事件循环，
    并发几个请求时整个服务就卡住了。
    """
    import instructor

    client = instructor.from_litellm(litellm.acompletion)
    return await client.chat.completions.create(
        model=_model_for(tier),
        response_model=response_model,
        messages=messages,
        max_retries=max_retries,
        timeout=settings.request_timeout,
        api_key=_api_key_for(_model_for(tier)),
    )


# 粗略单价（美元 / 1K tokens）。第 3 周换成真实账单核对。
_PRICE_PER_1K = {
    "deepseek/deepseek-chat": (0.00027, 0.0011),
    "openai/gpt-4o-mini": (0.00015, 0.0006),
    "ollama/": (0.0, 0.0),
}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    for prefix, (p_in, p_out) in _PRICE_PER_1K.items():
        if model.startswith(prefix):
            return round(prompt_tokens / 1000 * p_in + completion_tokens / 1000 * p_out, 6)
    return 0.0
