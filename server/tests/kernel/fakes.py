"""内核测试用的伪造实现。"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator

from cor_aiworker.kernel.events import TextDelta
from cor_aiworker.kernel.permissions import ApprovalRequest
from cor_aiworker.kernel.providers.base import ProviderEvent
from cor_aiworker.kernel.types import (
    NativeMessage,
    StopReason,
    ToolCall,
    ToolResult,
    ToolSpec,
    TurnResult,
    Usage,
)


class FakeProvider:
    """按脚本依次返回预设的回合结果。原生消息格式是自定义的简单 dict。"""

    name = "fake"
    model = "fake-1"

    def __init__(self, turns: list[TurnResult]) -> None:
        self._turns: Iterator[TurnResult] = iter(turns)
        self.seen_histories: list[list[NativeMessage]] = []
        self.seen_tools: list[list[str]] = []

    def user_message(self, text: str) -> NativeMessage:
        return {"role": "user", "text": text}

    def tool_result_messages(self, results: list[ToolResult]) -> list[NativeMessage]:
        return [
            {
                "role": "tool_results",
                "results": [
                    {"id": r.call_id, "content": r.content, "error": r.is_error} for r in results
                ],
            }
        ]

    def unanswered_tool_calls(self, history: list[NativeMessage]) -> list[str]:
        if history and history[-1]["role"] == "assistant":
            return list(history[-1].get("calls", []))
        return []

    async def stream(
        self, system: str, history: list[NativeMessage], tools: list[ToolSpec]
    ) -> AsyncIterator[ProviderEvent]:
        self.seen_histories.append(list(history))
        self.seen_tools.append([t.name for t in tools])
        turn = next(self._turns)
        if turn.text:
            yield TextDelta(text=turn.text)
        yield turn


def turn(
    *calls: ToolCall, text: str = "", stop: StopReason | None = None, usage: Usage | None = None
) -> TurnResult:
    """构造一个回合结果；有工具调用时默认 stop=tool_calls，否则 end。"""
    return TurnResult(
        text=text,
        tool_calls=list(calls),
        stop=stop or ("tool_calls" if calls else "end"),
        usage=usage or Usage(10, 5),
        messages=[{"role": "assistant", "text": text, "calls": [c.id for c in calls]}],
    )


def call(name: str, arguments: dict[str, object] | None = None, call_id: str = "c1") -> ToolCall:
    args = {} if arguments is None else arguments
    return ToolCall(call_id, name, args, str(args))


class RecordingGate:
    """审批闸门：按预设回答，并记录收到的审批请求。"""

    def __init__(self, approve: bool = True) -> None:
        self.approve = approve
        self.requests: list[ApprovalRequest] = []

    async def request(self, approval: ApprovalRequest) -> bool:
        self.requests.append(approval)
        return self.approve
