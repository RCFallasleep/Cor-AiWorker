from __future__ import annotations

from collections.abc import Iterator

import pytest
from mcp import Client
from mcp.server.mcpserver import MCPServer

from spikes.agent_loop.loop import MAX_IDENTICAL_CALLS, run_agent
from spikes.agent_loop.schema import parse_arguments
from spikes.agent_loop.tools import CURRENT_TIME_SPEC, ToolRegistry, get_current_time
from spikes.agent_loop.types import (
    Risk,
    StreamHandler,
    ToolCall,
    ToolResult,
    ToolSpec,
    TurnResult,
    Usage,
)


class FakeProvider:
    """按脚本依次返回预设的回合结果，并记录循环回传的内容。"""

    name = "fake"
    model = "fake-1"

    def __init__(self, turns: list[TurnResult]) -> None:
        self._turns: Iterator[TurnResult] = iter(turns)
        self.user_messages: list[str] = []
        self.tool_results: list[list[ToolResult]] = []

    def add_user_message(self, text: str) -> None:
        self.user_messages.append(text)

    def add_tool_results(self, results: list[ToolResult]) -> None:
        self.tool_results.append(results)

    async def stream_turn(
        self, system: str, tools: list[ToolSpec], handler: StreamHandler
    ) -> TurnResult:
        return next(self._turns)


class NullHandler:
    def on_thinking(self, delta: str) -> None: ...
    def on_text(self, delta: str) -> None: ...
    def on_tool_call(self, call: ToolCall) -> None: ...
    def on_tool_result(self, call: ToolCall, result: ToolResult) -> None: ...


async def allow_all(call: ToolCall, risk: Risk) -> bool:
    return True


async def deny_all(call: ToolCall, risk: Risk) -> bool:
    return False


def tool_turn(*calls: ToolCall) -> TurnResult:
    return TurnResult("", list(calls), "tool_calls", Usage(10, 5))


def end_turn(text: str = "完成") -> TurnResult:
    return TurnResult(text, [], "end", Usage(10, 5))


def time_call(call_id: str = "c1", tz: str = "UTC") -> ToolCall:
    return ToolCall(call_id, "get_current_time", {"timezone": tz}, f'{{"timezone": "{tz}"}}')


@pytest.fixture
def registry() -> ToolRegistry:
    reg = ToolRegistry()
    reg.add_local(CURRENT_TIME_SPEC, get_current_time)
    return reg


async def test_executes_tool_then_finishes(registry: ToolRegistry) -> None:
    provider = FakeProvider([tool_turn(time_call()), end_turn()])
    stats = await run_agent(provider, registry, "sys", "几点了", NullHandler(), allow_all)

    assert stats.turns == 2
    assert stats.tool_calls == 1
    assert stats.stop == "end"
    assert stats.usage.input_tokens == 20
    [[result]] = provider.tool_results
    assert result.call_id == "c1"
    assert not result.is_error
    assert "T" in result.content  # ISO 时间格式


async def test_invalid_arguments_are_returned_as_error(registry: ToolRegistry) -> None:
    bad = ToolCall("c1", "get_current_time", None, "{not json")
    provider = FakeProvider([tool_turn(bad), end_turn()])
    await run_agent(provider, registry, "sys", "q", NullHandler(), allow_all)

    [[result]] = provider.tool_results
    assert result.is_error
    assert "INVALID_JSON" in result.content


async def test_denied_call_is_not_executed() -> None:
    executed = False

    async def side_effect(arguments: dict[str, object]) -> str:
        nonlocal executed
        executed = True
        return "done"

    reg = ToolRegistry()
    reg.add_local(ToolSpec("write_note", "写笔记", {"type": "object"}), side_effect, risk="write")
    call = ToolCall("c1", "write_note", {}, "{}")
    provider = FakeProvider([tool_turn(call), end_turn()])
    await run_agent(provider, reg, "sys", "q", NullHandler(), deny_all)

    assert not executed
    assert provider.tool_results[0][0].is_error


async def test_repeated_identical_calls_are_blocked(registry: ToolRegistry) -> None:
    turns = [tool_turn(time_call(f"c{i}")) for i in range(MAX_IDENTICAL_CALLS + 1)]
    provider = FakeProvider([*turns, end_turn()])
    await run_agent(provider, registry, "sys", "q", NullHandler(), allow_all)

    results = [batch[0] for batch in provider.tool_results]
    assert not any(r.is_error for r in results[:MAX_IDENTICAL_CALLS])
    assert results[-1].is_error


async def test_stops_at_max_turns(registry: ToolRegistry) -> None:
    provider = FakeProvider([tool_turn(time_call(f"c{i}", tz=f"Etc/GMT+{i}")) for i in range(5)])
    stats = await run_agent(provider, registry, "sys", "q", NullHandler(), allow_all, max_turns=3)

    assert stats.turns == 3
    assert stats.stop == "max_turns"


async def test_truncated_turn_answers_dangling_tool_calls(registry: ToolRegistry) -> None:
    truncated = TurnResult("", [time_call()], "max_tokens", Usage())
    provider = FakeProvider([truncated])
    stats = await run_agent(provider, registry, "sys", "q", NullHandler(), allow_all)

    assert stats.stop == "max_tokens"
    [[result]] = provider.tool_results
    assert result.is_error  # 未执行，但补上了结果，保证历史合法


def test_parse_arguments_validates_schema() -> None:
    schema = {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]}
    assert parse_arguments('{"n": 1}', schema) == {"n": 1}
    assert parse_arguments('{"n": "1"}', schema) is None
    assert parse_arguments("[1]", schema) is None
    assert parse_arguments("{broken", schema) is None


async def test_mcp_tools_are_registered_and_marked_untrusted() -> None:
    server = MCPServer("test")

    @server.tool()
    def shout(text: str) -> str:
        """把文本转成大写。"""
        return text.upper()

    reg = ToolRegistry()
    async with Client(server) as client:
        names = await reg.add_mcp(client, risk="network")
        assert names == ["shout"]
        assert reg.risk("shout") == "network"
        result = await reg.call("c1", "shout", {"text": "hi"})

    assert not result.is_error
    assert "HI" in result.content
    assert result.content.startswith('<untrusted source="shout">')
