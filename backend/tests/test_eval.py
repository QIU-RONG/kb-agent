"""评测：把「效果好不好」变成可跑的数字。

没有这个文件，项目就只是个 demo。
第 2 周的任务就是让这个文件能跑出准确率，并接进 CI。

运行：
    pytest tests/test_eval.py -v

需要后端已启动（uvicorn app.main:app），且文档已入库。
"""

from __future__ import annotations

import os

import httpx
import pytest

BASE = os.getenv("API_BASE", "http://localhost:8000/api/v1")

# 黄金集：问题 → 期望答案里必须出现的关键词。
# 覆盖两类：①文档里明确有的 ②文档里没有的（考验会不会编）
#
# 注意：每一条都必须能在 docs/sample-财务制度.txt 里找到依据。
# 之前有一条「新员工入职要准备哪些材料」被判 FAIL，
# 查下来是语料里压根没写入职内容——那测的是测试集错误，不是系统问题。
# 加用例前先确认语料里有对应段落。
GOLDEN: list[dict] = [
    {"q": "报销流程需要几天？", "expect": ["工作日", "报销"], "has_answer": True},
    {"q": "一线城市住宿标准是多少？", "expect": ["600", "一线"], "has_answer": True},
    {"q": "年假可以跨年结转吗？", "expect": ["年假", "结转"], "has_answer": True},
    {"q": "公司股票代码是多少？", "expect": ["没有找到"], "has_answer": False},
    {"q": "食堂今天中午吃什么？", "expect": ["没有找到"], "has_answer": False},
]

ACCURACY_THRESHOLD = 0.8  # 低于这个值 CI 应该红


def _backend_alive() -> bool:
    try:
        return httpx.get(f"{BASE.replace('/api/v1', '')}/health", timeout=2).status_code == 200
    except Exception:  # noqa: BLE001
        return False


def _is_mock() -> bool:
    try:
        info = httpx.get(f"{BASE.replace('/api/v1', '')}/health", timeout=2).json()
        return info.get("llm_mode") == "mock"
    except Exception:  # noqa: BLE001
        return False


# mock 模式下的回答是固定文本，测准确率没有意义，
# 这里必须跳过而不是让它假通过——否则你会误以为效果达标了。
pytestmark = [
    pytest.mark.skipif(not _backend_alive(), reason="backend not running (uvicorn app.main:app)"),
    pytest.mark.skipif(_is_mock(), reason="LLM_MODE=mock，评测需要真实模型"),
]


def _ask(question: str) -> str:
    """走流式接口，把 delta 拼成完整答案。"""
    answer = ""
    with httpx.stream(
        "POST",
        f"{BASE}/chat/stream",
        json={"message": question},
        timeout=120,
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line.startswith("data:"):
                continue
            import json

            try:
                payload = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if "text" in payload:
                answer += payload["text"]
    return answer


def test_answer_accuracy():
    """命中率：答案里包含期望关键词的比例。"""
    passed = 0
    details: list[str] = []

    for case in GOLDEN:
        answer = _ask(case["q"])
        hit = all(kw in answer for kw in case["expect"])
        passed += int(hit)
        details.append(f"{'PASS' if hit else 'FAIL'} | {case['q']} | {answer[:60]}")

    accuracy = passed / len(GOLDEN)
    print("\n".join(details))
    print(f"\naccuracy = {accuracy:.2%} ({passed}/{len(GOLDEN)})")

    assert accuracy >= ACCURACY_THRESHOLD, f"accuracy {accuracy:.2%} below {ACCURACY_THRESHOLD:.0%}"


def test_no_hallucination_on_unknown():
    """文档里没有的问题，必须明确说找不到，而不是编答案。"""
    for case in [c for c in GOLDEN if not c["has_answer"]]:
        answer = _ask(case["q"])
        assert "没有找到" in answer or "未找到" in answer, (
            f"疑似幻觉：{case['q']} -> {answer[:120]}"
        )


# ---- 进阶（第 3 周）：用 deepeval 做更细的指标 ----
# from deepeval import evaluate
# from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric
# from deepeval.test_case import LLMTestCase
#
# def test_faithfulness():
#     """忠实度：答案是否完全来自检索到的上下文。"""
#     ...
