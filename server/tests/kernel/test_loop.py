from __future__ import annotations

from cor_aiworker.kernel.events import (
    ApprovalRequested,
    HistoryAppended,
    RunEvent,
    RunFinished,
    ToolResultReady,
)
from cor_aiworker.kernel.loop import Conversation, LoopConfig, run
from cor_aiworker.kernel.permissions import PermissionPolicy
from cor_aiworker.kernel.tools.registry import ToolOutput, ToolRegistry
from cor_aiworker.kernel.types import JSON, NativeMessage, Risk, ToolCall, ToolSpec

from .fakes import FakeProvider, RecordingGate, call, turn

SCHEMA: JSON = {"type": "object"}


class Spy:
    """记录调用次数的工具实现。"""

    def __init__(self, output: str = "ok") -> None:
        self.calls = 0
        self.output = output

    async def __call__(self, arguments: JSON) -> ToolOutput:
        self.calls += 1
        return ToolOutput(self.output)


def registry_with(*tools: tuple[str, Risk, bool, Spy]) -> ToolRegistry:
    reg = ToolRegistry()
    for name, risk, untrusted, handler in tools:
        reg.register(ToolSpec(name, name, SCHEMA), handler, risk=risk, untrusted=untrusted)
    return reg


async def collect(
    provider: FakeProvider,
    tools: ToolRegistry,
    *,
    gate: RecordingGate | None = None,
    policy: PermissionPolicy | None = None,
    history: list[JSON] | None = None,
    config: LoopConfig | None = None,
) -> tuple[list[RunEvent], Conversation]:
    conversation = Conversation(provider, history or [])
    events = [
        e
        async for e in run(
            conversation,
            "问题",
            system="sys",
            tools=tools,
            policy=policy or PermissionPolicy(),
            gate=gate or RecordingGate(),
            config=config,
        )
    ]
    return events, conversation


def of_type[T](events: list[RunEvent], cls: type[T]) -> list[T]:
    return [e for e in events if isinstance(e, cls)]


async def test_plain_answer_event_sequence() -> None:
    events, conversation = await collect(FakeProvider([turn(text="你好")]), ToolRegistry())

    assert [e.type for e in events] == [
        "run_started",
        "history_appended",  # 用户消息
        "text_delta",
        "history_appended",  # 助手消息
        "turn_finished",
        "run_finished",
    ]
    assert [m["role"] for m in conversation.history] == ["user", "assistant"]
    assert of_type(events, RunFinished)[0].stop == "end"


async def test_history_events_mirror_conversation() -> None:
    spy = Spy()
    events, conversation = await collect(
        FakeProvider([turn(call("t")), turn(text="完成")]), registry_with(("t", "read", False, spy))
    )
    appended = [m for e in of_type(events, HistoryAppended) for m in e.messages]
    assert appended == conversation.history


async def test_read_tool_runs_without_approval() -> None:
    spy, gate = Spy(), RecordingGate()
    events, _ = await collect(
        FakeProvider([turn(call("t")), turn(text="完成")]),
        registry_with(("t", "read", False, spy)),
        gate=gate,
    )
    assert spy.calls == 1
    assert gate.requests == []
    stats = of_type(events, RunFinished)[0]
    assert (stats.turns, stats.tool_calls, stats.usage.input_tokens) == (2, 1, 20)


async def test_network_tool_requires_approval() -> None:
    spy, gate = Spy(), RecordingGate(approve=True)
    events, _ = await collect(
        FakeProvider([turn(call("fetch")), turn(text="完成")]),
        registry_with(("fetch", "network", True, spy)),
        gate=gate,
    )
    assert spy.calls == 1
    assert len(gate.requests) == 1
    assert of_type(events, ApprovalRequested)[0].risk == "network"


async def test_denied_tool_is_not_executed() -> None:
    spy = Spy()
    events, _ = await collect(
        FakeProvider([turn(call("fetch")), turn(text="好的")]),
        registry_with(("fetch", "network", True, spy)),
        gate=RecordingGate(approve=False),
    )
    assert spy.calls == 0
    [result] = of_type(events, ToolResultReady)
    assert result.is_error


async def test_policy_deny_skips_approval() -> None:
    spy, gate = Spy(), RecordingGate()
    await collect(
        FakeProvider([turn(call("fetch")), turn(text="好的")]),
        registry_with(("fetch", "network", True, spy)),
        gate=gate,
        policy=PermissionPolicy({"fetch": "deny"}),
    )
    assert spy.calls == 0
    assert gate.requests == []


async def test_external_content_escalates_write_approval() -> None:
    """读取外部内容后，即使写工具被设为总是允许，也必须审批（ADR-005）。"""
    fetch, write = Spy("<网页内容>"), Spy()
    gate = RecordingGate(approve=False)
    events, _ = await collect(
        FakeProvider(
            [turn(call("fetch", call_id="a")), turn(call("write", call_id="b")), turn(text="完成")]
        ),
        registry_with(("fetch", "network", True, fetch), ("write", "write", False, write)),
        gate=gate,
        policy=PermissionPolicy({"fetch": "allow", "write": "allow"}),
    )
    assert fetch.calls == 1
    assert write.calls == 0
    [approval] = gate.requests
    assert approval.call.name == "write"
    assert "外部内容" in approval.reason
    assert of_type(events, ToolResultReady)[0].untrusted


async def test_write_allowed_when_not_tainted() -> None:
    write, gate = Spy(), RecordingGate()
    await collect(
        FakeProvider([turn(call("write")), turn(text="完成")]),
        registry_with(("write", "write", False, write)),
        gate=gate,
        policy=PermissionPolicy({"write": "allow"}),
    )
    assert write.calls == 1
    assert gate.requests == []


async def test_invalid_arguments_return_error_without_execution() -> None:
    spy = Spy()
    bad = ToolCall("c1", "t", None, "{broken")
    events, _ = await collect(
        FakeProvider([turn(bad), turn(text="完成")]), registry_with(("t", "read", False, spy))
    )
    assert spy.calls == 0
    [result] = of_type(events, ToolResultReady)
    assert result.is_error
    assert "INVALID_JSON" in result.content


async def test_unknown_tool_returns_error() -> None:
    gate = RecordingGate()
    events, _ = await collect(
        FakeProvider([turn(call("nope")), turn(text="完成")]), ToolRegistry(), gate=gate
    )
    [result] = of_type(events, ToolResultReady)
    assert result.is_error
    assert gate.requests == []


async def test_repeated_identical_calls_are_blocked() -> None:
    spy = Spy()
    limit = LoopConfig().max_identical_calls
    turns = [turn(call("t", call_id=f"c{i}")) for i in range(limit + 1)]
    events, _ = await collect(
        FakeProvider([*turns, turn(text="完成")]), registry_with(("t", "read", False, spy))
    )
    assert spy.calls == limit
    assert of_type(events, ToolResultReady)[-1].is_error


async def test_stops_at_max_turns() -> None:
    spy = Spy()
    turns = [turn(call("t", {"i": i}, call_id=f"c{i}")) for i in range(5)]
    events, _ = await collect(
        FakeProvider(turns),
        registry_with(("t", "read", False, spy)),
        config=LoopConfig(max_turns=3),
    )
    stats = of_type(events, RunFinished)[0]
    assert (stats.turns, stats.stop) == (3, "max_turns")


async def test_truncated_turn_answers_tool_calls_without_running_them() -> None:
    spy = Spy()
    events, conversation = await collect(
        FakeProvider([turn(call("t"), stop="max_tokens")]),
        registry_with(("t", "read", False, spy)),
    )
    assert spy.calls == 0
    assert of_type(events, RunFinished)[0].stop == "max_tokens"
    assert conversation.history[-1]["role"] == "tool_results"


async def test_dangling_tool_calls_are_healed_before_new_input() -> None:
    interrupted: list[NativeMessage] = [
        {"role": "user", "text": "之前的问题"},
        {"role": "assistant", "text": "", "calls": ["old1"]},
    ]
    provider = FakeProvider([turn(text="好的")])
    _, conversation = await collect(provider, ToolRegistry(), history=interrupted)

    sent = provider.seen_histories[0]
    assert sent[2]["role"] == "tool_results"
    assert sent[2]["results"][0]["id"] == "old1"
    assert sent[2]["results"][0]["error"]
    assert sent[3] == {"role": "user", "text": "问题"}
    assert len(conversation.history) == 5


async def test_tools_are_sent_sorted_by_name() -> None:
    provider = FakeProvider([turn(text="完成")])
    await collect(provider, registry_with(("b", "read", False, Spy()), ("a", "read", False, Spy())))
    assert provider.seen_tools[0] == ["a", "b"]
