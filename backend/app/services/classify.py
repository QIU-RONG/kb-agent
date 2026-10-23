"""工单分流：结构化输出 + 置信度阈值转人工。"""

from __future__ import annotations

import json
import logging
from typing import Literal

from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.llm import complete_json, is_mock

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是客服工单分流助手。请阅读工单内容，判断它属于哪一类，并评估紧急程度。

分类定义：
- billing   计费、发票、退款、支付失败
- account   登录、权限、账号信息修改
- bug       功能异常、报错、数据错误
- feature   新功能建议、体验优化
- other     无法归类

优先级：p0 线上不可用 / p1 影响主流程 / p2 有替代方案 / p3 咨询建议

务必保守：如果信息不足或存在多种可能，把 confidence 给低，不要猜。
"""


class TicketClassification(BaseModel):
    """schema 即约束。instructor 会拿它校验模型输出，不符合就带错误重试。"""

    category: Literal["billing", "account", "bug", "feature", "other"] = Field(
        description="工单分类"
    )
    priority: Literal["p0", "p1", "p2", "p3"] = Field(description="紧急程度")
    confidence: float = Field(ge=0, le=1, description="你对本次判断的置信度")
    reason: str = Field(description="一句话说明判断依据，不超过 50 字")


async def classify_ticket(title: str, body: str) -> tuple[TicketClassification, bool]:
    """返回 (分类结果, 是否需要人工)。"""
    if is_mock():
        return _heuristic(title, body)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"标题：{title}\n\n内容：{body}"},
    ]
    result: TicketClassification = await complete_json(
        messages=messages, response_model=TicketClassification, tier="fast"
    )
    needs_human = result.confidence < settings.classify_confidence_threshold
    logger.info(
        "ticket classified: %s/%s conf=%.2f human=%s",
        result.category,
        result.priority,
        result.confidence,
        needs_human,
    )
    return result, needs_human


def dump_raw(result: TicketClassification) -> str:
    """存原始输出，badcase 复盘时按 confidence 排序看。"""
    return json.dumps(result.model_dump(), ensure_ascii=False)


# ---------------- mock 模式 ----------------

_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("billing", ("发票", "退款", "支付", "扣费", "账单", "报销", "续费")),
    ("account", ("登录", "密码", "权限", "账号", "认证", "注册")),
    ("bug", ("报错", "崩溃", "无法", "异常", "失败", "打不开", "白屏", "500")),
    ("feature", ("建议", "希望", "能不能", "新增", "优化", "支持")),
]


def _heuristic(title: str, body: str) -> tuple[TicketClassification, bool]:
    """没配 key 时的规则兜底。

    置信度刻意给 0.55（低于阈值 0.7），让所有工单都进人工队列——
    这是诚实的设计：规则匹配不该假装自己有信心。
    """
    text = f"{title}\n{body}"
    for category, keywords in _RULES:
        if any(k in text for k in keywords):
            urgent = any(k in text for k in ("全部", "不可用", "紧急", "宕机"))
            result = TicketClassification(
                category=category,  # type: ignore[arg-type]
                priority="p1" if urgent else "p2",  # type: ignore[arg-type]
                confidence=0.55,
                reason=f"规则命中「{keywords[0]}」类关键词（mock 模式，未经模型判断）",
            )
            return result, True

    return (
        TicketClassification(
            category="other",
            priority="p3",
            confidence=0.3,
            reason="未命中任何关键词规则（mock 模式）",
        ),
        True,
    )
