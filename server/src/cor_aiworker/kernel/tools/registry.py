"""工具注册表：统一管理本地工具与 MCP 工具（docs/ARCHITECTURE.md 4.4）。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from ..context import mark_untrusted, truncate
from ..types import JSON, Risk, ToolCall, ToolResult, ToolSpec

DEFAULT_MAX_RESULT_CHARS = 20_000


@dataclass(frozen=True)
class ToolOutput:
    content: str
    is_error: bool = False


ToolHandler = Callable[[JSON], Awaitable[ToolOutput]]


@dataclass(frozen=True)
class _Entry:
    spec: ToolSpec
    handler: ToolHandler
    risk: Risk
    untrusted: bool  # 结果来自外部（网页、MCP 服务等），回传给模型前需加不可信标记


class ToolRegistry:
    def __init__(self, max_result_chars: int = DEFAULT_MAX_RESULT_CHARS) -> None:
        self._entries: dict[str, _Entry] = {}
        self._max_result_chars = max_result_chars

    def register(
        self, spec: ToolSpec, handler: ToolHandler, *, risk: Risk, untrusted: bool
    ) -> None:
        if spec.name in self._entries:
            raise ValueError(f"工具名重复：{spec.name}")
        self._entries[spec.name] = _Entry(spec, handler, risk, untrusted)

    def unregister_prefix(self, prefix: str) -> None:
        for name in [n for n in self._entries if n.startswith(prefix)]:
            del self._entries[name]

    def specs(self) -> list[ToolSpec]:
        # 按名称排序，保证每次请求的工具列表字节级稳定，避免提示缓存失效
        return [self._entries[name].spec for name in sorted(self._entries)]

    def has(self, name: str) -> bool:
        return name in self._entries

    def risk(self, name: str) -> Risk:
        entry = self._entries.get(name)
        return entry.risk if entry else "execute"  # 未知工具按最高风险处理

    def is_untrusted(self, name: str) -> bool:
        entry = self._entries.get(name)
        return entry.untrusted if entry else True

    async def call(self, call: ToolCall) -> ToolResult:
        entry = self._entries.get(call.name)
        if entry is None:
            return ToolResult(call.id, f"未知工具：{call.name}", is_error=True)
        if call.arguments is None:
            return ToolResult(call.id, "工具参数无效", is_error=True)
        try:
            output = await entry.handler(call.arguments)
        except Exception as exc:  # 工具失败回传给模型处理，不中断整个运行
            output = ToolOutput(f"工具执行失败：{type(exc).__name__}: {exc}", is_error=True)

        content = truncate(output.content, self._max_result_chars)
        if entry.untrusted:
            content = mark_untrusted(call.name, content)
        return ToolResult(call.id, content, output.is_error)
