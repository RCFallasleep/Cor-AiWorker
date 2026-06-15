from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Literal

import anthropic
import httpx
import openai

from app.schemas.chat import ChatRequest

logger = logging.getLogger(__name__)


def _resolve_protocol(body: ChatRequest) -> Literal["openai", "anthropic", "bedrock", "vertex"]:
    """确定最终使用的协议。
    优先级：前端显式传入 provider > api_key 前缀自动推断。
    """
    if body.provider:
        return body.provider
    return "anthropic" if body.api_key.strip().startswith("sk-ant-") else "openai"


def _sse(payload: dict) -> str:
    """将字典序列化为 SSE 事件字符串。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_chat(body: ChatRequest) -> AsyncGenerator[str, None]:
    """流式调用 LLM，以 SSE 格式逐块 yield 内容。

    协议优先级：前端显式传入 provider > api_key 前缀自动推断
    - provider=bedrock  → Bedrock 原生协议（httpx 直接调网关）
    - provider=anthropic / sk-ant-* → Anthropic SDK
    - 其他              → OpenAI 兼容协议
    """
    protocol = _resolve_protocol(body)
    logger.debug("chat stream start | model=%s protocol=%s", body.model, protocol)

    try:
        if protocol == "bedrock":
            async for chunk in _stream_bedrock(body):
                yield chunk
        elif protocol == "vertex":
            async for chunk in _stream_vertex(body):
                yield chunk
        elif protocol == "anthropic":
            async for chunk in _stream_anthropic(body):
                yield chunk
        else:
            async for chunk in _stream_openai(body):
                yield chunk
    except Exception as exc:
        logger.error("chat stream error | %s", exc, exc_info=True)
        yield _sse({"type": "error", "message": str(exc)})


# ── OpenAI 兼容协议 ──────────────────────────────────────────────────────────

def _to_openai_messages(body: ChatRequest) -> list[dict]:
    """将 ChatRequest.messages 转换为 OpenAI 兼容格式（支持多模态）。"""
    result = []
    for m in body.messages:
        if isinstance(m.content, str):
            result.append({"role": m.role, "content": m.content})
        else:
            # 多模态 part 列表，直接序列化
            result.append({"role": m.role, "content": [p.model_dump() for p in m.content]})
    return result


def _to_anthropic_content(content) -> str | list[dict]:
    """将 MessageContent 转换为 Anthropic SDK 格式。

    Anthropic vision 格式：
    [
      {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "..."}},
      {"type": "text", "text": "..."}
    ]
    """
    if isinstance(content, str):
        return content
    parts = []
    for p in content:
        if p.type == "text":
            parts.append({"type": "text", "text": p.text})
        elif p.type == "image_url":
            url = p.image_url.url
            if url.startswith("data:"):
                # base64 data URL: data:image/jpeg;base64,<data>
                header, data = url.split(",", 1)
                media_type = header.split(":")[1].split(";")[0]  # image/jpeg
                parts.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": data},
                })
            else:
                # 外部 URL（Anthropic 支持 url source）
                parts.append({
                    "type": "image",
                    "source": {"type": "url", "url": url},
                })
    return parts


async def _stream_openai(body: ChatRequest) -> AsyncGenerator[str, None]:
    client = openai.AsyncOpenAI(
        api_key=body.api_key,
        base_url=body.base_url or None,
        default_headers=body.extra_headers or None,
    )

    messages = _to_openai_messages(body)

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
        **({"default_headers": body.extra_headers} if body.extra_headers else {}),
    )

    # Anthropic 不支持 system 角色混在 messages 里，需单独提取
    system_parts = [
        m.content if isinstance(m.content, str) else " ".join(
            p.text for p in m.content if p.type == "text"
        )
        for m in body.messages if m.role == "system"
    ]
    user_messages = [
        {"role": m.role, "content": _to_anthropic_content(m.content)}
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


# ── Bedrock 原生协议（MaaS 网关 /bedrock_runtime/model/invoke-with-response-stream）──

def _build_bedrock_messages(body: ChatRequest) -> tuple[list[dict], str | None]:
    """将 ChatRequest.messages 转换为 Bedrock 原生格式（支持多模态）。
    - content 必须是数组：[{"type": "text", "text": "..."} | {"type": "image", ...}]
    - system 消息单独提取，不放在 messages 里
    返回 (messages, system_prompt)
    """
    system_parts = []
    for m in body.messages:
        if m.role == "system":
            system_parts.append(m.content if isinstance(m.content, str) else " ".join(
                p.text for p in m.content if p.type == "text"
            ))

    bedrock_messages = []
    for m in body.messages:
        if m.role == "system":
            continue
        anthropic_content = _to_anthropic_content(m.content)
        if isinstance(anthropic_content, str):
            content_list = [{"type": "text", "text": anthropic_content}]
        else:
            content_list = anthropic_content
        bedrock_messages.append({"role": m.role, "content": content_list})

    system_prompt = "\n\n".join(system_parts) if system_parts else None
    return bedrock_messages, system_prompt


async def _stream_bedrock(body: ChatRequest) -> AsyncGenerator[str, None]:
    """
    调用 MaaS Bedrock 网关（原生 Anthropic Messages 格式，HTTP chunked 流式）。

    网关特征：
    - URL：base_url（完整路径，如 https://maas.xxx/openai/openai/bedrock_runtime/model/invoke-with-response-stream）
    - 认证：extra_headers 中的 token 或其他自定义 Header
    - 请求体：Anthropic Messages API 原生格式（含 anthropic_version、thinking 等）
    - 响应：HTTP chunked，每行一个 JSON 事件（与 Anthropic SSE 事件结构相同）

    事件格式（每行 JSON）：
      {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "..."}}
      {"type": "message_delta", "usage": {"output_tokens": N}}
      {"type": "message_start", "message": {"usage": {"input_tokens": N, "output_tokens": N}}}
    """
    if not body.base_url:
        raise ValueError("Bedrock 协议需要填写 Base URL（网关完整地址）")

    bedrock_messages, system_prompt = _build_bedrock_messages(body)

    # 构造请求体（Anthropic Messages API 原生格式）
    payload: dict = {
        "model": body.model,
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8192,
        "messages": bedrock_messages,
    }
    if system_prompt:
        payload["system"] = system_prompt

    # 请求 Header：合并 extra_headers（含 token 等认证信息）
    headers = {
        "Content-Type": "application/json",
        **(body.extra_headers or {}),
    }

    input_tokens = 0
    output_tokens = 0

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            body.base_url,
            headers=headers,
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                error_body = await resp.aread()
                raise RuntimeError(
                    f"Bedrock 网关返回错误 {resp.status_code}: {error_body.decode()[:300]}"
                )

            # 逐行解析 JSON 事件（网关每行一个完整 JSON 对象）
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                # 兼容标准 SSE 格式（data: {...}）和裸 JSON 两种
                if line.startswith("data:"):
                    line = line[5:].strip()
                if not line or line == "[DONE]":
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug("bedrock: skip non-JSON line: %s", line[:80])
                    continue

                event_type = event.get("type", "")

                # 文字增量
                if event_type == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        text = delta.get("text", "")
                        if text:
                            yield _sse({"type": "delta", "content": text})

                # Token 用量（message_start 含 input_tokens）
                elif event_type == "message_start":
                    usage = event.get("message", {}).get("usage", {})
                    input_tokens = usage.get("input_tokens", 0)
                    output_tokens = usage.get("output_tokens", 0)

                # Token 用量（message_delta 含最终 output_tokens）
                elif event_type == "message_delta":
                    usage = event.get("usage", {})
                    output_tokens = usage.get("output_tokens", output_tokens)

                # 错误事件
                elif event_type == "error":
                    error_msg = event.get("error", {}).get("message", str(event))
                    raise RuntimeError(f"Bedrock 网关错误: {error_msg}")

    yield _sse({"type": "done", "input_tokens": input_tokens, "output_tokens": output_tokens})


# ── Vertex AI Anthropic 协议（MaaS 网关 /google/anthropic/v1:streamRawPredict）──

async def _stream_vertex(body: ChatRequest) -> AsyncGenerator[str, None]:
    """
    调用 MaaS Vertex AI Anthropic 网关（标准 SSE 流式）。

    网关特征：
    - URL：base_url（完整路径，如 https://maas.xxx/openai/openai/google/anthropic/v1:streamRawPredict）
    - 认证：extra_headers 中的 token 等自定义 Header
    - 请求体：Anthropic Messages API 格式，但不含 anthropic_version，不含 model（模型已在 URL 中）
    - 响应：标准 SSE 格式（data: {...}），事件结构与 Anthropic SDK 相同

    事件格式（SSE）：
      data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "..."}}
      data: {"type": "message_delta", "usage": {"output_tokens": N}}
      data: {"type": "message_start", "message": {"usage": {"input_tokens": N}}}
    """
    if not body.base_url:
        raise ValueError("Vertex AI 协议需要填写 Base URL（网关完整地址，含 v1:streamRawPredict）")

    # Vertex AI 格式：system 单独提取，messages 为标准 Anthropic 格式（content 为字符串）
    system_parts = [m.content for m in body.messages if m.role == "system"]
    user_messages = [
        {"role": m.role, "content": m.content}
        for m in body.messages
        if m.role != "system"
    ]

    # 请求体：不含 anthropic_version，不含 model（模型已在 URL 路径中）
    payload: dict = {
        "max_tokens": 8192,
        "messages": user_messages,
    }
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)

    # 请求 Header：合并 extra_headers（含 token 等认证信息）
    headers = {
        "Content-Type": "application/json",
        **(body.extra_headers or {}),
    }

    input_tokens = 0
    output_tokens = 0

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            body.base_url,
            headers=headers,
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                error_body = await resp.aread()
                raise RuntimeError(
                    f"Vertex AI 网关返回错误 {resp.status_code}: {error_body.decode()[:300]}"
                )

            # 逐行解析标准 SSE 事件
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                # 标准 SSE 格式：data: {...}
                if line.startswith("data:"):
                    line = line[5:].strip()
                if not line or line == "[DONE]":
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug("vertex: skip non-JSON line: %s", line[:80])
                    continue

                event_type = event.get("type", "")

                # 文字增量
                if event_type == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        text = delta.get("text", "")
                        if text:
                            yield _sse({"type": "delta", "content": text})

                # Token 用量（message_start 含 input_tokens）
                elif event_type == "message_start":
                    usage = event.get("message", {}).get("usage", {})
                    input_tokens = usage.get("input_tokens", 0)
                    output_tokens = usage.get("output_tokens", 0)

                # Token 用量（message_delta 含最终 output_tokens）
                elif event_type == "message_delta":
                    usage = event.get("usage", {})
                    output_tokens = usage.get("output_tokens", output_tokens)

                # 错误事件
                elif event_type == "error":
                    error_msg = event.get("error", {}).get("message", str(event))
                    raise RuntimeError(f"Vertex AI 网关错误: {error_msg}")

    yield _sse({"type": "done", "input_tokens": input_tokens, "output_tokens": output_tokens})
