"""MCP 服务接入：连接服务、以命名空间注册其工具。"""

from __future__ import annotations

import re
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from mcp import Client, StdioServerParameters

from ..types import JSON, Risk, ToolSpec
from .registry import ToolHandler, ToolOutput, ToolRegistry

# Anthropic 与 OpenAI 对工具名的共同约束
_INVALID_NAME_CHARS = re.compile(r"[^a-zA-Z0-9_-]")
_MAX_NAME_LENGTH = 64


@dataclass(frozen=True)
class McpServerConfig:
    name: str
    command: str
    args: tuple[str, ...] = ()
    env: dict[str, str] | None = None
    risk: Risk = "network"
    # 外部 MCP 服务的输出一律视为不可信；只有确认为纯本地、内容可控的服务才应设为 False
    untrusted: bool = True
    enabled: bool = True


def namespaced_tool_name(server: str, tool: str) -> str:
    """MCP 工具注册为 {服务名}__{工具名}，避免重名并让来源可见。"""
    return _INVALID_NAME_CHARS.sub("_", f"{server}__{tool}")[:_MAX_NAME_LENGTH]


async def register_client(
    registry: ToolRegistry, server: str, client: Client, *, risk: Risk, untrusted: bool = True
) -> list[str]:
    """把一个已连接 MCP 客户端的全部工具注册到注册表，返回注册后的工具名。"""
    names: list[str] = []
    cursor: str | None = None
    while True:
        page = await client.list_tools(cursor=cursor)
        for tool in page.tools:
            name = namespaced_tool_name(server, tool.name)
            spec = ToolSpec(name, tool.description or "", dict(tool.input_schema))
            registry.register(
                spec, _make_handler(client, tool.name), risk=risk, untrusted=untrusted
            )
            names.append(name)
        cursor = page.next_cursor
        if cursor is None:
            return names


def _make_handler(client: Client, tool_name: str) -> ToolHandler:
    async def handler(arguments: JSON) -> ToolOutput:
        result = await client.call_tool(tool_name, arguments)
        content = "\n".join(_render_content(block) for block in result.content)
        return ToolOutput(content, is_error=bool(result.is_error))

    return handler


def _render_content(block: Any) -> str:
    if getattr(block, "type", None) == "text":
        return str(block.text)
    return f"[{getattr(block, 'type', 'unknown')} 内容已省略]"


class McpConnections:
    """管理 MCP 子进程的生命周期。用法：async with McpConnections(registry) as mcp: ..."""

    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry
        self._stack = AsyncExitStack()

    async def __aenter__(self) -> McpConnections:
        await self._stack.__aenter__()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self._stack.aclose()

    async def connect(self, config: McpServerConfig) -> list[str]:
        params = StdioServerParameters(
            command=config.command, args=list(config.args), env=config.env
        )
        client = await self._stack.enter_async_context(Client(params))
        return await register_client(
            self._registry, config.name, client, risk=config.risk, untrusted=config.untrusted
        )
