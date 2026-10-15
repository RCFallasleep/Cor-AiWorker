"""OpenAI 兼容协议适配器：DeepSeek 及其他提供 /chat/completions 接口的模型。"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterable
from typing import Any

from openai import AsyncOpenAI
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall

from ..events import TextDelta, ThinkingDelta
from ..streams import with_idle_timeout
from ..types import NativeMessage, StopReason, ToolCall, ToolResult, ToolSpec, TurnResult, Usage
from ..validation import parse_arguments
from .base import DEFAULT_IDLE_TIMEOUT, ProviderEvent

_STOP_MAP: dict[str, StopReason] = {
    "stop": "end",
    "tool_calls": "tool_calls",
    "length": "max_tokens",
    "content_filter": "refusal",
}


class ToolCallAccumulator:
    """工具调用按 index 分片下发：id 与 name 先到，arguments 逐段拼接。"""

    def __init__(self) -> None:
        self._slots: dict[int, dict[str, str]] = {}

    def add(self, deltas: Iterable[ChoiceDeltaToolCall]) -> None:
        for delta in deltas:
            slot = self._slots.setdefault(delta.index, {"id": "", "name": "", "arguments": ""})
            if delta.id:
                slot["id"] = delta.id
            if delta.function and delta.function.name:
                slot["name"] = delta.function.name
            if delta.function and delta.function.arguments:
                slot["arguments"] += delta.function.arguments

    def calls(self) -> list[dict[str, str]]:
        return [self._slots[i] for i in sorted(self._slots)]


def prepare_history(history: list[NativeMessage]) -> list[NativeMessage]:
    """发送前的预处理：只保留当前问题内的 reasoning_content。

    DeepSeek 思考模式下，同一问题内的工具循环需要回传 reasoning_content；
    之前问题的推理内容不再需要，回传只会浪费 Token。存储中仍完整保留。
    """
    last_user = max((i for i, m in enumerate(history) if m.get("role") == "user"), default=-1)
    prepared: list[NativeMessage] = []
    for i, message in enumerate(history):
        if i < last_user and message.get("role") == "assistant" and "reasoning_content" in message:
            message = {k: v for k, v in message.items() if k != "reasoning_content"}
        prepared.append(message)
    return prepared


def map_stop(raw_stop: str, has_calls: bool) -> StopReason:
    stop = _STOP_MAP.get(raw_stop, "other")
    # 部分兼容实现带工具调用时仍返回 finish_reason="stop"
    if has_calls and stop == "end":
        return "tool_calls"
    return stop


class OpenAICompatProvider:
    def __init__(
        self,
        *,
        name: str,
        api_key: str,
        base_url: str,
        model: str,
        idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self.name = name
        self.model = model
        self._client = client or AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._idle_timeout = idle_timeout

    def user_message(self, text: str) -> NativeMessage:
        return {"role": "user", "content": text}

    def tool_result_messages(self, results: list[ToolResult]) -> list[NativeMessage]:
        # OpenAI 协议没有 is_error 字段，错误只能写进内容
        return [
            {
                "role": "tool",
                "tool_call_id": r.call_id,
                "content": f"[ERROR] {r.content}" if r.is_error else r.content,
            }
            for r in results
        ]

    def unanswered_tool_calls(self, history: list[NativeMessage]) -> list[str]:
        pending: list[str] = []
        for message in history:
            if message.get("role") == "assistant":
                pending = [str(c["id"]) for c in message.get("tool_calls") or []]
            elif message.get("role") == "tool":
                pending = [i for i in pending if i != message.get("tool_call_id")]
        return pending

    async def stream(
        self, system: str, history: list[NativeMessage], tools: list[ToolSpec]
    ) -> AsyncIterator[ProviderEvent]:
        schemas = {t.name: t.input_schema for t in tools}
        tool_params: list[Any] = [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                },
            }
            for t in tools
        ]
        messages: list[Any] = [{"role": "system", "content": system}, *prepare_history(history)]

        stream = await self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tool_params,
            stream=True,
            stream_options={"include_usage": True},
        )

        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        accumulator = ToolCallAccumulator()
        raw_stop = ""
        usage = Usage()

        async for chunk in with_idle_timeout(stream, self._idle_timeout):
            if chunk.usage:
                # 缓存命中字段不统一：
                # OpenAI 在 prompt_tokens_details，DeepSeek 是 prompt_cache_hit_tokens
                details = chunk.usage.prompt_tokens_details
                cached = (details.cached_tokens if details else None) or getattr(
                    chunk.usage, "prompt_cache_hit_tokens", 0
                )
                usage = Usage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens, cached or 0)
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta

            # reasoning_content 是 DeepSeek 的扩展字段，不在 OpenAI SDK 的类型定义里
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                reasoning_parts.append(reasoning)
                yield ThinkingDelta(text=reasoning)
            if delta.content:
                text_parts.append(delta.content)
                yield TextDelta(text=delta.content)
            if delta.tool_calls:
                accumulator.add(delta.tool_calls)
            if choice.finish_reason:
                raw_stop = choice.finish_reason

        text = "".join(text_parts)
        slots = accumulator.calls()
        assistant: NativeMessage = {"role": "assistant", "content": text or None}
        if slots:
            assistant["tool_calls"] = [
                {
                    "id": s["id"],
                    "type": "function",
                    "function": {"name": s["name"], "arguments": s["arguments"]},
                }
                for s in slots
            ]
        if reasoning_parts:
            assistant["reasoning_content"] = "".join(reasoning_parts)

        calls = [
            ToolCall(
                s["id"],
                s["name"],
                parse_arguments(s["arguments"], schemas.get(s["name"], {})),
                s["arguments"],
            )
            for s in slots
        ]
        yield TurnResult(
            text=text,
            tool_calls=calls,
            stop=map_stop(raw_stop, bool(calls)),
            usage=usage,
            messages=[assistant],
            raw_stop=raw_stop,
        )
