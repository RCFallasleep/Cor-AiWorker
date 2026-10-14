"""Claude 适配器：官方 Anthropic SDK 原生接入。

不走 OpenAI 兼容层，因为那样会丢掉 adaptive thinking、effort、
thinking 块回传、拒答回退（fallbacks）等原生能力。
"""

from __future__ import annotations

import json
from typing import Any, Literal

from anthropic import AsyncAnthropic
from anthropic.types.beta import BetaMessageParam

from .schema import validate_arguments
from .types import (
    JSON,
    StopReason,
    StreamHandler,
    ToolCall,
    ToolResult,
    ToolSpec,
    TurnResult,
    Usage,
)

# fallbacks="default"：模型因安全分类器拒答时，由服务端按拒答类别自动换模型重试
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_INVALID_JSON_RETRIES = 2

Effort = Literal["low", "medium", "high", "xhigh", "max"]

_STOP_MAP: dict[str, StopReason] = {
    "end_turn": "end",
    "tool_use": "tool_calls",
    "max_tokens": "max_tokens",
    "refusal": "refusal",
}


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        api_key: str,
        model: str = "claude-opus-5-5",
        effort: Effort = "medium",
        max_tokens: int = 64000,
    ) -> None:
        self._client = AsyncAnthropic(api_key=api_key)
        self.model = model
        self._effort = effort
        self._max_tokens = max_tokens
        self._messages: list[BetaMessageParam] = []

    def add_user_message(self, text: str) -> None:
        self._messages.append({"role": "user", "content": text})

    def add_tool_results(self, results: list[ToolResult]) -> None:
        # 一轮的所有 tool_result 必须放在同一条 user 消息里
        self._messages.append(
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
        )

    async def stream_turn(
        self, system: str, tools: list[ToolSpec], handler: StreamHandler
    ) -> TurnResult:
        schemas = {t.name: t.input_schema for t in tools}
        tool_params: list[Any] = [
            {
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
                # 流式请求下让工具参数边生成边下发；代价是服务端不再校验，需自行校验
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
                    messages=self._messages,
                    thinking={"type": "adaptive", "display": "summarized"},
                    output_config={"effort": self._effort},
                    cache_control={"type": "ephemeral"},
                    betas=[FALLBACK_BETA],
                    fallbacks="default",
                ) as stream:
                    async for event in stream:
                        if event.type == "content_block_delta":
                            if event.delta.type == "thinking_delta":
                                handler.on_thinking(event.delta.thinking)
                            elif event.delta.type == "text_delta":
                                handler.on_text(event.delta.text)
                    final = await stream.get_final_message()
                break
            except ValueError:
                # SDK 无法解析模型生成的工具参数 JSON；此时拿不到 tool_use_id，只能重发本轮
                if attempt == MAX_INVALID_JSON_RETRIES:
                    raise

        # 必须原样回传完整 content（含 thinking 块），不能只保存文本
        self._messages.append({"role": "assistant", "content": final.content})

        text = "".join(b.text for b in final.content if b.type == "text")
        calls: list[ToolCall] = []
        for block in final.content:
            if block.type != "tool_use":
                continue
            args: JSON | None = validate_arguments(block.input, schemas.get(block.name, {}))
            calls.append(ToolCall(block.id, block.name, args, json.dumps(block.input)))

        raw_stop = final.stop_reason or ""
        usage = Usage(
            input_tokens=final.usage.input_tokens,
            output_tokens=final.usage.output_tokens,
            cache_read_tokens=final.usage.cache_read_input_tokens or 0,
        )
        return TurnResult(text, calls, _STOP_MAP.get(raw_stop, "other"), usage, raw_stop)
