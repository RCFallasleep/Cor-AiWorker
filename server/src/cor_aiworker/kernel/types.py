"""内核公共类型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

JSON = dict[str, Any]

# 某个协议的原生消息（Anthropic 的 MessageParam、OpenAI 的 chat message 等），
# 以可 JSON 序列化的 dict 形式保存，原样存取，不做跨协议转换（ADR-002）。
NativeMessage = dict[str, Any]

Risk = Literal["read", "network", "write", "execute"]
StopReason = Literal["end", "tool_calls", "max_tokens", "refusal", "other"]


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
    """Token 用量。input_tokens 统一为「总输入」，包含缓存命中与缓存写入。"""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens


@dataclass(frozen=True)
class TurnResult:
    """一次模型调用的结果。messages 是需要追加到会话历史的原生消息。"""

    text: str
    tool_calls: list[ToolCall]
    stop: StopReason
    usage: Usage
    messages: list[NativeMessage] = field(default_factory=list)
    raw_stop: str = ""
