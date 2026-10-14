from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncGenerator

import openai

from app.schemas.chat import AgentDeductionConfig, DeductionRequest

logger = logging.getLogger(__name__)

# 单个 Agent 推演超时（秒）
AGENT_TIMEOUT_SECONDS = 120


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _build_agent_messages(agent: AgentDeductionConfig, topic: str) -> list[dict]:
    """为单个 Agent 构建推演消息列表。"""
    # System Prompt = 原始 System Prompt + 职位角色 + 任务 Prompt
    parts: list[str] = []

    if agent.system_prompt:
        parts.append(agent.system_prompt.strip())

    if agent.role:
        parts.append(f"\n## 你在本次推演中的职位\n{agent.role}")

    if agent.task_prompt:
        parts.append(f"\n## 你的具体任务\n{agent.task_prompt}")
    else:
        parts.append(
            f"\n## 你的任务\n请针对以下议题，从你的专业视角进行深入分析，给出你的观点和建议。"
        )

    system_content = "\n".join(parts)

    return [
        {"role": "system", "content": system_content},
        {
            "role": "user",
            "content": (
                f"议题：{topic}\n\n"
                "请基于你的职位和任务，给出你的分析与结论。"
                "要求：逻辑清晰、有理有据、结论明确，300-500字。"
            ),
        },
    ]


async def _stream_single_agent(
    agent: AgentDeductionConfig,
    topic: str,
    queue: asyncio.Queue[str | None],
) -> None:
    """单个 Agent 流式推演，结果写入 queue。None 表示该 Agent 完成。"""
    agent_id = agent.id

    async def put(payload: dict) -> None:
        await queue.put(_sse({**payload, "agent_id": agent_id}))

    try:
        api_key = agent.api_key or os.environ.get("OPENAI_API_KEY", "")
        client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url=agent.base_url or None,
            default_headers=agent.extra_headers or {},
        )

        messages = _build_agent_messages(agent, topic)

        await put({"type": "agent_start", "name": agent.name, "role": agent.role})

        stream = await client.chat.completions.create(
            model=agent.model,
            messages=messages,  # type: ignore[arg-type]
            temperature=0.7,
            stream=True,
        )

        full_text = ""
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                full_text += delta.content
                await put({"type": "delta", "content": delta.content})

        await put({"type": "agent_done", "full_text": full_text})

    except asyncio.TimeoutError:
        logger.warning("deduction: agent %s timed out", agent_id)
        await put({"type": "agent_error", "message": f"推演超时（>{AGENT_TIMEOUT_SECONDS}s）"})
    except openai.APIError as e:
        logger.error("deduction: agent %s API error | %s", agent_id, e)
        await put({"type": "agent_error", "message": f"API 错误：{e}"})
    except Exception as e:
        logger.error("deduction: agent %s unexpected error | %s", agent_id, e, exc_info=True)
        await put({"type": "agent_error", "message": str(e)})
    finally:
        # 发送 None 表示该 Agent 完成（无论成功还是失败）
        await queue.put(None)


async def stream_deduction(request: DeductionRequest) -> AsyncGenerator[str, None]:
    """并行推演入口：所有 Agent 同时启动，SSE 事件带 agent_id 字段。

    SSE 事件类型（均含 agent_id 字段）：
    - {"type": "agent_start",  "agent_id": "...", "name": "...", "role": "..."}
    - {"type": "delta",        "agent_id": "...", "content": "..."}
    - {"type": "agent_done",   "agent_id": "...", "full_text": "..."}
    - {"type": "agent_error",  "agent_id": "...", "message": "..."}
    - {"type": "all_done"}   所有 Agent 完成后推送
    """
    if not request.agents:
        yield _sse({"type": "all_done"})
        return

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    pending = len(request.agents)

    # 并行启动所有 Agent（带超时包装）
    tasks = [
        asyncio.create_task(
            asyncio.wait_for(
                _stream_single_agent(agent, request.topic, queue),
                timeout=AGENT_TIMEOUT_SECONDS,
            )
        )
        for agent in request.agents
    ]

    try:
        while pending > 0:
            item = await queue.get()
            if item is None:
                # 某个 Agent 完成
                pending -= 1
            else:
                yield item
    finally:
        # 取消所有未完成的任务
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    yield _sse({"type": "all_done"})
