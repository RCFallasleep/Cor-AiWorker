"""内置工具。"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..types import JSON, ToolSpec
from .registry import ToolOutput, ToolRegistry

CURRENT_TIME = ToolSpec(
    name="get_current_time",
    description=(
        "获取当前日期和时间。用户问到「现在几点」或需要计算相对时间时使用；"
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


async def get_current_time(arguments: JSON) -> ToolOutput:
    tz_name = arguments.get("timezone") or "Asia/Shanghai"
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return ToolOutput(f"无效的时区：{tz_name}", is_error=True)
    return ToolOutput(datetime.now(tz).isoformat(timespec="seconds"))


def register_builtin_tools(registry: ToolRegistry) -> None:
    registry.register(CURRENT_TIME, get_current_time, risk="read", untrusted=False)
