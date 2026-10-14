from __future__ import annotations

import logging
from collections.abc import Callable, Coroutine
from typing import Any

logger = logging.getLogger(__name__)

# Tool 处理函数类型：接收 kwargs，返回字符串结果
ToolHandler = Callable[..., Coroutine[Any, Any, str]]


class ToolDefinition:
    """单个 Tool 的定义，符合 MCP / OpenAI Function Calling 规范。"""

    def __init__(
        self,
        name: str,
        description: str,
        parameters: dict,  # JSON Schema 格式
        handler: ToolHandler,
    ) -> None:
        self.name = name
        self.description = description
        self.parameters = parameters
        self.handler = handler

    def to_openai_schema(self) -> dict:
        """转换为 OpenAI Function Calling 格式。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    """Tool 注册表，支持动态注册/注销/查询。"""

    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, tool: ToolDefinition) -> None:
        """注册一个 Tool。"""
        self._tools[tool.name] = tool
        logger.info("tool registered | name=%s", tool.name)

    def unregister(self, name: str) -> None:
        """注销一个 Tool。"""
        self._tools.pop(name, None)
        logger.info("tool unregistered | name=%s", name)

    def get(self, name: str) -> ToolDefinition | None:
        """按名称查询 Tool。"""
        return self._tools.get(name)

    def all(self) -> list[ToolDefinition]:
        """返回所有已注册的 Tool。"""
        return list(self._tools.values())

    def to_openai_schemas(self) -> list[dict]:
        """返回所有 Tool 的 OpenAI Function Calling 格式列表。"""
        return [t.to_openai_schema() for t in self._tools.values()]

    async def execute(self, name: str, args: dict) -> str:
        """执行指定 Tool，返回结果字符串。工具不存在时返回错误信息。"""
        tool = self.get(name)
        if tool is None:
            logger.warning("tool not found | name=%s", name)
            return f"[错误] 工具 '{name}' 不存在"
        try:
            result = await tool.handler(**args)
            logger.debug("tool executed | name=%s args=%s", name, args)
            return result
        except Exception as exc:
            logger.error("tool execution failed | name=%s error=%s", name, exc, exc_info=True)
            return f"[错误] 工具 '{name}' 执行失败：{exc}"


# 全局单例注册表
tool_registry = ToolRegistry()
