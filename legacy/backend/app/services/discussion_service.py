"""discussion_service.py — 研讨会模式推演服务（动态轮次版）。

核心流程：
  Round N: 所有非组织者 Agent 并行发言（Round 1 独立观点，Round 2+ 基于前轮回应）
  每轮结束后：组织者做「裁判」判断，决定是否继续下一轮（最多 MAX_ROUNDS 轮）
  Final:    组织者读取所有轮次的全部发言，输出最终综合结论

SSE 事件类型：
  - {"type": "discussion_round_start", "round": N, "agent_ids": [...]}
  - {"type": "agent_start",      "agent_id": "...", "name": "...", "role": "...", "round": N}
  - {"type": "delta",            "agent_id": "...", "content": "...", "round": N}
  - {"type": "agent_done",       "agent_id": "...", "full_text": "...", "round": N}
  - {"type": "agent_error",      "agent_id": "...", "message": "...", "round": N}
  - {"type": "organizer_decision","round": N, "continue": true/false, "reason": "..."}
  - {"type": "organizer_start",  "agent_id": "...", "name": "...", "role": "..."}
  - {"type": "organizer_delta",  "agent_id": "...", "content": "..."}
  - {"type": "organizer_done",   "agent_id": "...", "full_text": "..."}
  - {"type": "all_done"}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncGenerator

import openai

from app.schemas.chat import AgentDeductionConfig

logger = logging.getLogger(__name__)

# 单个 Agent 推演超时（秒）
AGENT_TIMEOUT_SECONDS = 120
# 最大讨论轮数（防止无限循环）
MAX_ROUNDS = 5


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _make_client(agent: AgentDeductionConfig) -> openai.AsyncOpenAI:
    return openai.AsyncOpenAI(
        api_key=agent.api_key or os.environ.get("OPENAI_API_KEY", ""),
        base_url=agent.base_url or None,
        default_headers=agent.extra_headers or {},
    )


def _build_round_messages(
    agent: AgentDeductionConfig,
    topic: str,
    round_num: int,
    all_prev_outputs: list[list[dict]],  # [round1_outputs, round2_outputs, ...]
) -> list[dict]:
    """构建第 round_num 轮的发言 prompt。
    Round 1：独立发言；Round 2+：基于前轮所有发言进行回应。
    """
    parts: list[str] = []
    if agent.system_prompt:
        parts.append(agent.system_prompt.strip())
    if agent.role:
        parts.append(f"\n## 你在本次研讨中的职位\n{agent.role}")

    if round_num == 1:
        if agent.task_prompt:
            parts.append(f"\n## 你的具体任务\n{agent.task_prompt}")
        else:
            parts.append("\n## 你的任务\n请针对以下议题，从你的专业视角进行深入分析，给出你的初步观点和建议。")
        system_content = "\n".join(parts)
        user_content = (
            f"议题：{topic}\n\n"
            "请基于你的职位和专业背景，给出你的初步分析与观点。"
            "要求：逻辑清晰、有理有据、结论明确，300-500字。"
        )
    else:
        parts.append(
            f"\n## 你的任务（第 {round_num} 轮）\n"
            "你已经看到了其他与会者前几轮的发言。请认真阅读，"
            "结合你的专业视角进行回应、补充或辩论。\n"
            "你可以：赞同某人的观点并深化、反驳某人的观点并给出理由、提出新的角度或被忽视的问题。"
        )
        system_content = "\n".join(parts)

        user_parts: list[str] = [f"议题：{topic}\n\n"]
        for r_idx, round_outputs in enumerate(all_prev_outputs, start=1):
            user_parts.append(f"## 第 {r_idx} 轮发言\n")
            for out in round_outputs:
                if out.get("agent_id") == agent.id:
                    user_parts.append(f"### {out['name']}（{out['role']}）【你自己的发言】：\n{out['output']}\n\n")
                else:
                    user_parts.append(f"### {out['name']}（{out['role']}）：\n{out['output']}\n\n")
        user_parts.append(
            f"---\n请基于以上所有发言，给出你第 {round_num} 轮的回应与深化分析。"
            "要求：有针对性地回应至少一位与会者的观点，逻辑清晰，200-400字。"
        )
        user_content = "".join(user_parts)

    return [
        {"role": "system", "content": system_content},
        {"role": "user",   "content": user_content},
    ]


def _build_organizer_decision_messages(
    organizer: AgentDeductionConfig,
    topic: str,
    round_num: int,
    all_outputs: list[list[dict]],
) -> list[dict]:
    """组织者裁判 prompt：判断是否需要继续下一轮讨论。"""
    system_content = (
        f"{organizer.system_prompt or ''}\n\n"
        f"## 你的职位\n{organizer.role or '研讨会主持人'}\n\n"
        "## 你的任务\n"
        f"你是本次研讨会的组织者。与会者已完成第 {round_num} 轮讨论。\n"
        "请评估当前讨论质量，判断是否需要继续下一轮讨论。\n\n"
        "判断标准：\n"
        "- 如果各方观点已经充分交流、核心分歧已经明确、继续讨论收益递减 → 结束\n"
        "- 如果还有重要问题未被充分探讨、存在明显的逻辑漏洞或遗漏视角 → 继续\n\n"
        "你必须以 JSON 格式回复，不要有任何其他内容：\n"
        '{"continue": true/false, "reason": "一句话说明你的判断理由"}'
    )

    user_parts: list[str] = [f"议题：{topic}\n\n"]
    for r_idx, round_outputs in enumerate(all_outputs, start=1):
        user_parts.append(f"## 第 {r_idx} 轮发言\n")
        for out in round_outputs:
            user_parts.append(f"### {out['name']}（{out['role']}）：\n{out['output']}\n\n")
    user_parts.append(f"---\n请判断是否需要进行第 {round_num + 1} 轮讨论，以 JSON 格式回复。")

    return [
        {"role": "system", "content": system_content},
        {"role": "user",   "content": "".join(user_parts)},
    ]


def _build_organizer_summary_messages(
    organizer: AgentDeductionConfig,
    topic: str,
    all_outputs: list[list[dict]],
) -> list[dict]:
    """组织者最终总结 prompt。"""
    total_rounds = len(all_outputs)
    parts: list[str] = []
    if organizer.system_prompt:
        parts.append(organizer.system_prompt.strip())
    parts.append(
        f"\n## 你的职位\n{organizer.role or '研讨会主持人与总结者'}\n\n"
        "## 你的任务\n"
        f"你是本次研讨会的组织者。与会者共完成了 {total_rounds} 轮讨论。\n"
        "请综合所有与会者的发言，输出一份结构清晰的最终总结报告，包含：\n"
        "1. 核心共识（各方认同的观点）\n"
        "2. 主要分歧（各方存在争议的地方）\n"
        "3. 综合结论（你作为组织者的最终判断与建议）\n"
        "4. 行动建议（如有）\n\n"
        "要求：客观公正、逻辑严密、结论明确，500-800字。"
    )
    system_content = "\n".join(parts)

    user_parts: list[str] = [f"议题：{topic}\n\n"]
    for r_idx, round_outputs in enumerate(all_outputs, start=1):
        user_parts.append(f"## 第 {r_idx} 轮发言\n")
        for out in round_outputs:
            user_parts.append(f"### {out['name']}（{out['role']}）：\n{out['output']}\n\n")
    user_parts.append("---\n请输出最终综合总结报告。")

    return [
        {"role": "system", "content": system_content},
        {"role": "user",   "content": "".join(user_parts)},
    ]


# ── 单个 Agent 流式调用 ────────────────────────────────────────────────────────

async def _stream_agent(
    agent: AgentDeductionConfig,
    messages: list[dict],
    queue: asyncio.Queue,
    round_num: int,
    event_prefix: str = "",
) -> str:
    """流式调用单个 Agent，将 SSE 事件放入队列，返回完整输出文本。"""
    agent_id = agent.id
    prefix = event_prefix

    async def put(payload: dict) -> None:
        await queue.put(_sse(payload))

    try:
        client = _make_client(agent)
        start_type = f"{prefix}_start" if prefix else "agent_start"
        delta_type  = f"{prefix}_delta" if prefix else "delta"
        done_type   = f"{prefix}_done"  if prefix else "agent_done"

        await put({
            "type": start_type,
            "agent_id": agent_id,
            "name": agent.name,
            "role": agent.role,
            **({"round": round_num} if not prefix else {}),
        })

        stream = await asyncio.wait_for(
            client.chat.completions.create(
                model=agent.model,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.7,
                stream=True,
            ),
            timeout=AGENT_TIMEOUT_SECONDS,
        )

        full_text = ""
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                full_text += delta.content
                await put({
                    "type": delta_type,
                    "agent_id": agent_id,
                    "content": delta.content,
                    **({"round": round_num} if not prefix else {}),
                })

        await put({
            "type": done_type,
            "agent_id": agent_id,
            "full_text": full_text,
            **({"round": round_num} if not prefix else {}),
        })
        return full_text

    except asyncio.TimeoutError:
        logger.warning("discussion: agent %s round %d timed out", agent_id, round_num)
        err_type = f"{prefix}_error" if prefix else "agent_error"
        await put({
            "type": err_type,
            "agent_id": agent_id,
            "message": f"推演超时（>{AGENT_TIMEOUT_SECONDS}s）",
            **({"round": round_num} if not prefix else {}),
        })
        return ""

    except openai.APIError as e:
        logger.error("discussion: agent %s round %d API error | %s", agent_id, round_num, e)
        err_type = f"{prefix}_error" if prefix else "agent_error"
        await put({
            "type": err_type,
            "agent_id": agent_id,
            "message": f"API 错误：{e}",
            **({"round": round_num} if not prefix else {}),
        })
        return ""

    except Exception as e:
        logger.error("discussion: agent %s round %d unexpected error | %s", agent_id, round_num, e, exc_info=True)
        err_type = f"{prefix}_error" if prefix else "agent_error"
        await put({
            "type": err_type,
            "agent_id": agent_id,
            "message": str(e),
            **({"round": round_num} if not prefix else {}),
        })
        return ""


async def _organizer_decide(
    organizer: AgentDeductionConfig,
    topic: str,
    round_num: int,
    all_outputs: list[list[dict]],
) -> tuple[bool, str]:
    """组织者裁判：非流式调用，返回 (是否继续, 理由)。"""
    try:
        client = _make_client(organizer)
        messages = _build_organizer_decision_messages(organizer, topic, round_num, all_outputs)
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=organizer.model,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.2,   # 低温度，让判断更稳定
                stream=False,
                response_format={"type": "json_object"},
            ),
            timeout=30,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        should_continue = bool(data.get("continue", False))
        reason = str(data.get("reason", ""))
        return should_continue, reason
    except Exception as e:
        logger.warning("organizer decision failed: %s, defaulting to stop", e)
        return False, "判断过程出现异常，结束讨论"


# ── 核心研讨会调度器 ──────────────────────────────────────────────────────────

async def stream_discussion(
    topic: str,
    agents: list[AgentDeductionConfig],
    organizer_id: str,
) -> AsyncGenerator[str, None]:
    """研讨会模式推演入口。

    动态轮次：每轮结束后由组织者 Agent 判断是否继续，最多 MAX_ROUNDS 轮。

    Args:
        topic: 推演议题
        agents: 所有参与 Agent（含组织者）
        organizer_id: 组织者 Agent ID
    """
    if not agents:
        yield _sse({"type": "all_done"})
        return

    organizer = next((a for a in agents if a.id == organizer_id), None)
    members   = [a for a in agents if a.id != organizer_id]

    if not members:
        yield _sse({"type": "all_done"})
        return

    if organizer is None:
        organizer = agents[0]
        members   = agents[1:]

    member_ids = [a.id for a in members]
    all_outputs: list[list[dict]] = []  # 所有轮次的输出，all_outputs[i] = 第 i+1 轮

    # ── 动态多轮讨论 ──────────────────────────────────────────────────────────
    for round_num in range(1, MAX_ROUNDS + 1):
        yield _sse({"type": "discussion_round_start", "round": round_num, "agent_ids": member_ids})

        queue: asyncio.Queue[str] = asyncio.Queue()
        tasks = [
            asyncio.create_task(
                _stream_agent(
                    agent=m,
                    messages=_build_round_messages(m, topic, round_num, all_outputs),
                    queue=queue,
                    round_num=round_num,
                )
            )
            for m in members
        ]

        # 消费本轮 SSE 事件
        pending = set(tasks)
        while pending:
            while not queue.empty():
                yield await queue.get()
            done, pending = await asyncio.wait(pending, timeout=0.05)
        while not queue.empty():
            yield await queue.get()

        # 收集本轮输出
        round_outputs: list[dict] = []
        for task, member in zip(tasks, members):
            output = task.result() if not task.exception() else ""
            round_outputs.append({
                "agent_id": member.id,
                "name": member.name,
                "role": member.role,
                "output": output,
            })
        all_outputs.append(round_outputs)

        # ── 组织者裁判：判断是否继续 ──────────────────────────────────────────
        if round_num < MAX_ROUNDS:
            should_continue, reason = await _organizer_decide(
                organizer, topic, round_num, all_outputs
            )
            yield _sse({
                "type": "organizer_decision",
                "round": round_num,
                "continue": should_continue,
                "reason": reason,
            })
            if not should_continue:
                break
        # 已达最大轮数，直接结束循环

    # ── Final：组织者综合总结（流式）────────────────────────────────────────
    yield _sse({
        "type": "discussion_round_start",
        "round": 0,
        "agent_ids": [organizer.id],
        "label": "组织者总结",
    })

    queue_org: asyncio.Queue[str] = asyncio.Queue()
    org_task = asyncio.create_task(
        _stream_agent(
            agent=organizer,
            messages=_build_organizer_summary_messages(organizer, topic, all_outputs),
            queue=queue_org,
            round_num=0,
            event_prefix="organizer",
        )
    )

    while not org_task.done():
        while not queue_org.empty():
            yield await queue_org.get()
        await asyncio.sleep(0.05)
    while not queue_org.empty():
        yield await queue_org.get()

    yield _sse({"type": "all_done"})
