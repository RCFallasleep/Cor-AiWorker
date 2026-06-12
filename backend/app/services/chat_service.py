from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Literal

import anthropic
import openai

from app.schemas.chat import ChatRequest

logger = logging.getLogger(__name__)


def _detect_protocol(api_key: str) -> Literal["anthropic", "openai"]:
    """根据 API Key 前缀自动识别协议。
    sk-ant-* → Anthropic，其他 → OpenAI 兼容协议。
    """
    return "anthropic" if api_key.strip().startswith("sk-ant-") else "openai"


def _sse(payload: dict) -> str:
    """将字典序列化为 SSE 事件字符串。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_chat(body: ChatRequest) -> AsyncGenerator[str, None]:
    """流式调用 LLM，以 SSE 格式逐块 yield 内容。

    协议自动识别：
    - api_key 以 sk-ant- 开头 → Anthropic
    - 其他 → OpenAI 兼容协议
    """
    protocol = _detect_protocol(body.api_key)
    logger.debug("chat stream start | model=%s protocol=%s", body.model, protocol)

    try:
        if protocol == "anthropic":
            async for chunk in _stream_anthropic(body):
                yield chunk
        else:
            async for chunk in _stream_openai(body):
                yield chunk
    except Exception as exc:
        logger.error("chat stream error | %s", exc, exc_info=True)
        yield _sse({"type": "error", "message": str(exc)})


# ── OpenAI 兼容协议 ──────────────────────────────────────────────────────────

async def _stream_openai(body: ChatRequest) -> AsyncGenerator[str, None]:
    client = openai.AsyncOpenAI(
        api_key=body.api_key,
        base_url=body.base_url or None,
    )

    messages = [m.model_dump() for m in body.messages]

    stream = await client.chat.completions.create(
        model=body.model,
        messages=messages,  # type: ignore[arg-type]
        stream=True,
        stream_options={"include_usage": True},
    )

    input_tokens = 0
    output_tokens = 0

    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield _sse({"type": "delta", "content": delta})
        if chunk.usage:
            input_tokens = chunk.usage.prompt_tokens or 0
            output_tokens = chunk.usage.completion_tokens or 0

    yield _sse({"type": "done", "input_tokens": input_tokens, "output_tokens": output_tokens})


# ── Anthropic ────────────────────────────────────────────────────────────────

async def _stream_anthropic(body: ChatRequest) -> AsyncGenerator[str, None]:
    client = anthropic.AsyncAnthropic(
        api_key=body.api_key,
        **({"base_url": body.base_url} if body.base_url else {}),
    )

    # Anthropic 不支持 system 角色混在 messages 里，需单独提取
    system_parts = [m.content for m in body.messages if m.role == "system"]
    user_messages = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role != "system"
    ]

    kwargs: dict = {
        "model": body.model,
        "max_tokens": 8192,
        "messages": user_messages,
    }
    if system_parts:
        kwargs["system"] = "\n\n".join(system_parts)

    input_tokens = 0
    output_tokens = 0

    async with client.messages.stream(**kwargs) as stream:
        async for event in stream:
            if (
                event.type == "content_block_delta"
                and event.delta.type == "text_delta"
            ):
                yield _sse({"type": "delta", "content": event.delta.text})

        final = await stream.get_final_message()
        input_tokens = final.usage.input_tokens
        output_tokens = final.usage.output_tokens

    yield _sse({"type": "done", "input_tokens": input_tokens, "output_tokens": output_tokens})
