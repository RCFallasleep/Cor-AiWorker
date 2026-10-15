"""Provider 协议。

适配器是无状态的：会话历史由调用方以原生格式持有并传入，适配器只负责
「原生历史 → 调用模型 → 原生新消息」，以及发送前对历史做协议相关的预处理。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from ..events import TextDelta, ThinkingDelta
from ..types import NativeMessage, ToolResult, ToolSpec, TurnResult

ProviderEvent = ThinkingDelta | TextDelta | TurnResult

DEFAULT_IDLE_TIMEOUT = 180.0


class Provider(Protocol):
    name: str
    model: str

    def user_message(self, text: str) -> NativeMessage: ...

    def tool_result_messages(self, results: list[ToolResult]) -> list[NativeMessage]:
        """同一轮的全部工具结果对应的原生消息。"""
        ...

    def unanswered_tool_calls(self, history: list[NativeMessage]) -> list[str]:
        """历史末尾「有工具调用、尚无结果」的调用 id，用于运行开始前的历史自愈。"""
        ...

    def stream(
        self, system: str, history: list[NativeMessage], tools: list[ToolSpec]
    ) -> AsyncIterator[ProviderEvent]:
        """流式产出思考与正文片段，最后产出一个 TurnResult。"""
        ...
