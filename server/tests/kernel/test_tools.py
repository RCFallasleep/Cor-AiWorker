from __future__ import annotations

import pytest
from mcp import Client
from mcp.server.mcpserver import MCPServer

from cor_aiworker.kernel.tools.builtin import register_builtin_tools
from cor_aiworker.kernel.tools.mcp import namespaced_tool_name, register_client
from cor_aiworker.kernel.tools.registry import ToolOutput, ToolRegistry
from cor_aiworker.kernel.types import JSON, ToolCall, ToolSpec


def make_call(name: str, arguments: JSON | None = None) -> ToolCall:
    return ToolCall("c1", name, arguments if arguments is not None else {}, "{}")


async def echo(arguments: JSON) -> ToolOutput:
    return ToolOutput(str(arguments.get("text", "")))


async def boom(arguments: JSON) -> ToolOutput:
    raise RuntimeError("坏了")


def test_duplicate_names_are_rejected() -> None:
    reg = ToolRegistry()
    spec = ToolSpec("t", "", {"type": "object"})
    reg.register(spec, echo, risk="read", untrusted=False)
    with pytest.raises(ValueError, match="重复"):
        reg.register(spec, echo, risk="read", untrusted=False)


def test_unknown_tool_is_treated_as_highest_risk() -> None:
    reg = ToolRegistry()
    assert reg.risk("nope") == "execute"
    assert reg.is_untrusted("nope")


async def test_handler_exception_becomes_error_result() -> None:
    reg = ToolRegistry()
    reg.register(ToolSpec("t", "", {"type": "object"}), boom, risk="read", untrusted=False)
    result = await reg.call(make_call("t"))
    assert result.is_error
    assert "坏了" in result.content


async def test_untrusted_results_are_marked_and_truncated() -> None:
    reg = ToolRegistry(max_result_chars=5)
    reg.register(ToolSpec("t", "", {"type": "object"}), echo, risk="network", untrusted=True)
    result = await reg.call(make_call("t", {"text": "0123456789"}))
    assert result.content.startswith('<untrusted source="t">')
    assert "原长 10" in result.content


async def test_builtin_time_tool() -> None:
    reg = ToolRegistry()
    register_builtin_tools(reg)
    ok = await reg.call(make_call("get_current_time", {"timezone": "UTC"}))
    assert not ok.is_error
    assert ok.content.endswith("+00:00")
    bad = await reg.call(make_call("get_current_time", {"timezone": "Mars/Base"}))
    assert bad.is_error


def test_namespaced_tool_name() -> None:
    assert namespaced_tool_name("fetch", "fetch") == "fetch__fetch"
    assert namespaced_tool_name("my server", "do.it") == "my_server__do_it"
    assert len(namespaced_tool_name("s" * 50, "t" * 50)) == 64


async def test_mcp_tools_registered_with_namespace() -> None:
    server = MCPServer("test")

    @server.tool()
    def shout(text: str) -> str:
        """把文本转成大写。"""
        return text.upper()

    reg = ToolRegistry()
    async with Client(server) as client:
        names = await register_client(reg, "demo", client, risk="network")
        assert names == ["demo__shout"]
        assert reg.risk("demo__shout") == "network"
        result = await reg.call(make_call("demo__shout", {"text": "hi"}))

    assert not result.is_error
    assert "HI" in result.content
    assert result.content.startswith('<untrusted source="demo__shout">')
