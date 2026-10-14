"""工具注册表：统一管理本地工具与 MCP 工具，并为每个工具标注风险等级。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mcp import Client, StdioServerParameters

from .types import JSON, Risk, ToolResult, ToolSpec

MAX_RESULT_CHARS = 20_000

LocalHandler = Callable[[JSON], Awaitable[str]]


@dataclass
class _Entry:
    spec: ToolSpec
    risk: Risk
    # 来自外部（网页、MCP 服务）的结果视为不可信，回传时加标记
    untrusted: bool
    local: LocalHandler | None = None
    mcp: Client | None = None


class ToolRegistry:
    def __init__(self) -> None:
        self._entries: dict[str, _Entry] = {}

    def specs(self) -> list[ToolSpec]:
        return [e.spec for e in self._entries.values()]

    def risk(self, name: str) -> Risk:
        entry = self._entries.get(name)
        # 未知工具按最高风险处理
        return entry.risk if entry else "write"

    def add_local(self, spec: ToolSpec, handler: LocalHandler, risk: Risk = "read") -> None:
        self._entries[spec.name] = _Entry(spec, risk, untrusted=False, local=handler)

    async def add_mcp(self, client: Client, risk: Risk) -> list[str]:
        """注册一个已连接 MCP 服务的全部工具，返回工具名列表。"""
        names: list[str] = []
        cursor: str | None = None
        while True:
            page = await client.list_tools(cursor=cursor)
            for tool in page.tools:
                spec = ToolSpec(tool.name, tool.description or "", dict(tool.input_schema))
                self._entries[tool.name] = _Entry(spec, risk, untrusted=True, mcp=client)
                names.append(tool.name)
            cursor = page.next_cursor
            if cursor is None:
                return names

    async def connect_stdio_mcp(
        self, stack: AsyncExitStack, command: str, args: list[str], risk: Risk
    ) -> list[str]:
        client = await stack.enter_async_context(
            Client(StdioServerParameters(command=command, args=args))
        )
        return await self.add_mcp(client, risk)

    async def call(self, call_id: str, name: str, arguments: JSON) -> ToolResult:
        entry = self._entries.get(name)
        if entry is None:
            return ToolResult(call_id, f"未知工具：{name}", is_error=True)
        try:
            if entry.local is not None:
                content, is_error = await entry.local(arguments), False
            elif entry.mcp is not None:
                result = await entry.mcp.call_tool(name, arguments)
                content = "\n".join(_render_content(c) for c in result.content)
                is_error = bool(result.is_error)
            else:
                return ToolResult(call_id, f"工具未绑定实现：{name}", is_error=True)
        except Exception as exc:  # 工具失败要回传给模型，而不是中断整个循环
            return ToolResult(call_id, f"工具执行失败：{type(exc).__name__}: {exc}", is_error=True)

        if len(content) > MAX_RESULT_CHARS:
            content = content[:MAX_RESULT_CHARS] + f"\n…[已截断，原长 {len(content)} 字符]"
        if entry.untrusted:
            content = f'<untrusted source="{name}">\n{content}\n</untrusted>'
        return ToolResult(call_id, content, is_error)


def _render_content(block: Any) -> str:
    if getattr(block, "type", None) == "text":
        return str(block.text)
    return f"[{getattr(block, 'type', 'unknown')} 内容已省略]"


# ── 内置本地工具 ────────────────────────────────────────────────────────────

CURRENT_TIME_SPEC = ToolSpec(
    name="get_current_time",
    description=(
        "获取当前日期和时间。用户问到「现在几点」「今天几号」或需要计算相对日期时使用；"
        "系统提示词里已有今天的日期，只需要日期时不必调用。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "IANA 时区名，例如 Asia/Shanghai。缺省为 Asia/Shanghai。",
            }
        },
        "additionalProperties": False,
    },
)


async def get_current_time(arguments: JSON) -> str:
    tz_name = arguments.get("timezone") or "Asia/Shanghai"
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return f"无效的时区：{tz_name}"
    return datetime.now(tz).isoformat(timespec="seconds")
