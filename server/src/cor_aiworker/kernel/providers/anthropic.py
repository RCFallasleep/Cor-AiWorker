"""Claude 适配器：官方 Anthropic SDK 原生接入（ADR-001）。

不走 OpenAI 兼容层：那样会丢掉 adaptive thinking、effort、thinking 块回传、
服务端拒答回退（fallbacks）等原生能力。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any, Literal, cast

from anthropic import AsyncAnthropic
from anthropic.types.beta import BetaMessageParam

from ..events import TextDelta, ThinkingDelta
from ..streams import with_idle_timeout
from ..types import NativeMessage, StopReason, ToolCall, ToolResult, ToolSpec, TurnResult, Usage
from ..validation import validate_arguments
from .base import DEFAULT_IDLE_TIMEOUT, ProviderEvent

Effort = Literal["low", "medium", "high", "xhigh", "max"]

# fallbacks="default"：因安全分类器拒答时，由服务端按拒答类别自动换模型重试
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_INVALID_JSON_RETRIES = 2

_STOP_MAP: dict[str, StopReason] = {
    "end_turn": "end",
    "tool_use": "tool_calls",
    "max_tokens": "max_tokens",
    "refusal": "refusal",
}


class AnthropicProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "claude-opus-5-5",
        name: str = "anthropic",
        effort: Effort = "medium",
        max_tokens: int = 64000,
        idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
        client: AsyncAnthropic | None = None,
    ) -> None:
        self.name = name
        self.model = model
        self._client = client or AsyncAnthropic(api_key=api_key)
        self._effort: Effort = effort
        self._max_tokens = max_tokens
        self._idle_timeout = idle_timeout

    def user_message(self, text: str) -> NativeMessage:
        return {"role": "user", "content": text}

    def tool_result_messages(self, results: list[ToolResult]) -> list[NativeMessage]:
        # 同一轮的所有 tool_result 必须放在同一条 user 消息里
        return [
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": r.call_id,
                        "content": r.content,
                        "is_error": r.is_error,
                    }
                    for r in results
                ],
            }
        ]

    def unanswered_tool_calls(self, history: list[NativeMessage]) -> list[str]:
        if not history or history[-1].get("role") != "assistant":
            return []
        content = history[-1].get("content")
        if not isinstance(content, list):
            return []
        return [
            str(block["id"])
            for block in content
            if isinstance(block, dict) and block.get("type") == "tool_use"
        ]

    async def stream(
        self, system: str, history: list[NativeMessage], tools: list[ToolSpec]
    ) -> AsyncIterator[ProviderEvent]:
        schemas = {t.name: t.input_schema for t in tools}
        tool_params: list[Any] = [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
                # 流式请求下让工具参数边生成边下发；代价是服务端不再校验，由我们自行校验
                "eager_input_streaming": True,
            }
            for t in tools
        ]

        for attempt in range(MAX_INVALID_JSON_RETRIES + 1):
            try:
                async with self._client.beta.messages.stream(
                    model=self.model,
                    max_tokens=self._max_tokens,
                    system=system,
                    tools=tool_params,
                    messages=cast("list[BetaMessageParam]", history),
                    thinking={"type": "adaptive", "display": "summarized"},
                    output_config={"effort": self._effort},
                    cache_control={"type": "ephemeral"},
                    betas=[FALLBACK_BETA],
                    fallbacks="default",
                ) as stream:
                    async for event in with_idle_timeout(stream, self._idle_timeout):
                        if event.type == "content_block_delta":
                            if event.delta.type == "thinking_delta":
                                yield ThinkingDelta(text=event.delta.thinking)
                            elif event.delta.type == "text_delta":
                                yield TextDelta(text=event.delta.text)
                    final = await stream.get_final_message()
                break
            except ValueError:
                # SDK 无法解析模型生成的工具参数 JSON，此时拿不到 tool_use_id，只能重发本轮。
                # 已经产出的片段会在重发后再出现一次，属于罕见情况，接受这个代价。
                if attempt == MAX_INVALID_JSON_RETRIES:
                    raise

        # 必须原样回传完整 content（含 thinking 块与签名），转成可序列化的 dict 保存
        assistant: NativeMessage = {
            "role": "assistant",
            "content": [block.to_dict() for block in final.content],
        }

        calls: list[ToolCall] = []
        for block in final.content:
            if block.type == "tool_use":
                args = validate_arguments(block.input, schemas.get(block.name, {}))
                calls.append(ToolCall(block.id, block.name, args, json.dumps(block.input)))

        cache_read = final.usage.cache_read_input_tokens or 0
        cache_write = final.usage.cache_creation_input_tokens or 0
        raw_stop = final.stop_reason or ""
        yield TurnResult(
            text="".join(b.text for b in final.content if b.type == "text"),
            tool_calls=calls,
            stop=_STOP_MAP.get(raw_stop, "other"),
            usage=Usage(
                # Anthropic 的 input_tokens 只含未走缓存的部分，统一换算为总输入
                input_tokens=final.usage.input_tokens + cache_read + cache_write,
                output_tokens=final.usage.output_tokens,
                cache_read_tokens=cache_read,
                cache_write_tokens=cache_write,
            ),
            messages=[assistant],
            raw_stop=raw_stop,
        )
