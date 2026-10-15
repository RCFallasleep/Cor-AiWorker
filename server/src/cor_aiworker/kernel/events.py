"""运行事件：Agent 循环对外的唯一输出（ADR-003）。

UI、运行日志、会话持久化、评测都消费同一串事件。
事件会被序列化写入运行日志，修改字段时需考虑旧日志的兼容。
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Literal

from .types import JSON, NativeMessage, Risk, ToolCall, Usage


@dataclass(frozen=True, kw_only=True)
class RunStarted:
    type: Literal["run_started"] = "run_started"
    provider: str
    model: str


@dataclass(frozen=True, kw_only=True)
class ThinkingDelta:
    type: Literal["thinking_delta"] = "thinking_delta"
    text: str


@dataclass(frozen=True, kw_only=True)
class TextDelta:
    type: Literal["text_delta"] = "text_delta"
    text: str


@dataclass(frozen=True, kw_only=True)
class ToolCallRequested:
    type: Literal["tool_call"] = "tool_call"
    call: ToolCall
    risk: Risk


@dataclass(frozen=True, kw_only=True)
class ApprovalRequested:
    type: Literal["approval_requested"] = "approval_requested"
    approval_id: str
    call_id: str
    tool_name: str
    risk: Risk
    reason: str


@dataclass(frozen=True, kw_only=True)
class ApprovalResolved:
    type: Literal["approval_resolved"] = "approval_resolved"
    approval_id: str
    approved: bool


@dataclass(frozen=True, kw_only=True)
class ToolResultReady:
    type: Literal["tool_result"] = "tool_result"
    call_id: str
    tool_name: str
    content: str
    is_error: bool
    untrusted: bool


@dataclass(frozen=True, kw_only=True)
class TurnFinished:
    type: Literal["turn_finished"] = "turn_finished"
    turn: int
    stop: str
    usage: Usage


@dataclass(frozen=True, kw_only=True)
class RunFinished:
    type: Literal["run_finished"] = "run_finished"
    stop: str
    turns: int
    tool_calls: int
    usage: Usage
    elapsed: float


@dataclass(frozen=True, kw_only=True)
class RunFailed:
    """由应用层在运行异常时产出，内核循环本身不捕获异常。"""

    type: Literal["run_failed"] = "run_failed"
    error: str


@dataclass(frozen=True, kw_only=True)
class HistoryAppended:
    """内部事件：有新的原生消息需要写入会话历史。只用于持久化，不推送给 UI。"""

    type: Literal["history_appended"] = "history_appended"
    messages: list[NativeMessage] = field(default_factory=list)


RunEvent = (
    RunStarted
    | ThinkingDelta
    | TextDelta
    | ToolCallRequested
    | ApprovalRequested
    | ApprovalResolved
    | ToolResultReady
    | TurnFinished
    | RunFinished
    | RunFailed
    | HistoryAppended
)

INTERNAL_EVENT_TYPES = frozenset({"history_appended"})


def event_to_dict(event: RunEvent) -> JSON:
    return dataclasses.asdict(event)


def is_internal(event: RunEvent) -> bool:
    return event.type in INTERNAL_EVENT_TYPES
