"""Agent 循环与模型适配器之间的公共契约。

设计要点：对话历史由各 Provider 以「原生格式」自行持有。
Anthropic 的 thinking 块、DeepSeek 的 reasoning_content 都必须原样回传，
统一成一种中间格式会丢信息，所以循环只通过 add_* / stream_turn 与 Provider 交互。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

JSON = dict[str, Any]

StopReason = Literal["end", "tool_calls", "max_tokens", "refusal", "other"]
Risk = Literal["read", "network", "write"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: JSON


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: JSON | None  # None 表示参数无法解析或不符合 schema
    raw_arguments: str


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    content: str
    is_error: bool = False


@dataclass
class Usage:
    # input_tokens 统一为「总输入」，包含缓存命中与缓存写入的部分。
    # 注意两种协议口径不同：OpenAI 的 prompt_tokens 本身就是总数，
    # Anthropic 的 input_tokens 只含未走缓存的部分，适配器需自行相加。
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens


@dataclass
class TurnResult:
    text: str
    tool_calls: list[ToolCall]
    stop: StopReason
    usage: Usage
    raw_stop: str = ""


class StreamHandler(Protocol):
    def on_thinking(self, delta: str) -> None: ...
    def on_text(self, delta: str) -> None: ...
    def on_tool_call(self, call: ToolCall) -> None: ...
    def on_tool_result(self, call: ToolCall, result: ToolResult) -> None: ...


class Provider(Protocol):
    name: str
    model: str

    def add_user_message(self, text: str) -> None: ...
    def add_tool_results(self, results: list[ToolResult]) -> None: ...
    async def stream_turn(
        self, system: str, tools: list[ToolSpec], handler: StreamHandler
    ) -> TurnResult:
        """流式生成一轮回复，并把助手消息追加到自身历史中。"""
        ...
