"""OpenAI 兼容协议适配器：DeepSeek 及其他提供 /chat/completions 接口的模型。

DeepSeek 思考模式下，同一个问题内的工具循环需要把 reasoning_content 回传；
新问题开始时，之前轮次的 reasoning_content 不再需要，回传只会浪费 token。
"""

from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI

from .schema import parse_arguments
from .types import StopReason, StreamHandler, ToolCall, ToolResult, ToolSpec, TurnResult, Usage

_STOP_MAP: dict[str, StopReason] = {
    "stop": "end",
    "tool_calls": "tool_calls",
    "length": "max_tokens",
    "content_filter": "refusal",
}


class OpenAICompatProvider:
    def __init__(self, name: str, api_key: str, base_url: str, model: str) -> None:
        self.name = name
        self.model = model
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._messages: list[dict[str, Any]] = []

    def add_user_message(self, text: str) -> None:
        for message in self._messages:
            if message["role"] == "assistant":
                message.pop("reasoning_content", None)
        self._messages.append({"role": "user", "content": text})

    def add_tool_results(self, results: list[ToolResult]) -> None:
        # OpenAI 协议没有 is_error 字段，只能把错误写进内容里
        for r in results:
            content = f"[ERROR] {r.content}" if r.is_error else r.content
            self._messages.append({"role": "tool", "tool_call_id": r.call_id, "content": content})

    async def stream_turn(
        self, system: str, tools: list[ToolSpec], handler: StreamHandler
    ) -> TurnResult:
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
        messages: list[Any] = [{"role": "system", "content": system}, *self._messages]

        stream = await self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tool_params,
            stream=True,
            stream_options={"include_usage": True},
        )

        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        # 工具调用按 index 分片下发：id 和 name 先到，arguments 逐段拼接
        slots: dict[int, dict[str, str]] = {}
        raw_stop = ""
        usage = Usage()

        async for chunk in stream:
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
                handler.on_thinking(reasoning)
            if delta.content:
                text_parts.append(delta.content)
                handler.on_text(delta.content)
            for tc in delta.tool_calls or []:
                slot = slots.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function and tc.function.name:
                    slot["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    slot["arguments"] += tc.function.arguments
            if choice.finish_reason:
                raw_stop = choice.finish_reason

        text = "".join(text_parts)
        ordered = [slots[i] for i in sorted(slots)]
        assistant: dict[str, Any] = {"role": "assistant", "content": text or None}
        if ordered:
            assistant["tool_calls"] = [
                {
                    "id": s["id"],
                    "type": "function",
                    "function": {"name": s["name"], "arguments": s["arguments"]},
                }
                for s in ordered
            ]
        if reasoning_parts:
            assistant["reasoning_content"] = "".join(reasoning_parts)
        self._messages.append(assistant)

        calls = [
            ToolCall(
                s["id"],
                s["name"],
                parse_arguments(s["arguments"], schemas.get(s["name"], {})),
                s["arguments"],
            )
            for s in ordered
        ]
        stop = _STOP_MAP.get(raw_stop, "other")
        # 部分兼容实现带工具调用时仍返回 finish_reason="stop"
        if calls and stop == "end":
            stop = "tool_calls"
        return TurnResult(text, calls, stop, usage, raw_stop)
