"""
debug_tools.py — 断点调试 MCP 工具

注册三个工具到全局 tool_registry：
  - get_debug_snapshot   获取最新断点快照（变量/调用栈）
  - set_breakpoint       向 Android Studio 推送断点推荐
  - wait_for_breakpoint  等待新断点命中（用户负责在 AS 运行，Agent 等待结果）
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import httpx

from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)

# ── 延迟导入（避免循环依赖）──────────────────────────────────────────────────
def _get_snapshots():
    from app.api.v1.debug_bridge import get_snapshots_deque
    return get_snapshots_deque()

def _get_event():
    from app.api.v1.debug_bridge import get_snapshot_event
    return get_snapshot_event()

_LOBI_CALLBACK_URL = "http://localhost:18766/recommend"
_BACKEND_RECOMMEND_URL = "http://localhost:8000/v1/debug/recommend"


# ── get_debug_snapshot ────────────────────────────────────────────────────────

async def _get_debug_snapshot_handler(index: int = -1) -> str:
    """
    获取断点快照。
    index=-1 表示最新一条，index=0 表示最早一条。
    """
    snapshots = _get_snapshots()
    if not snapshots:
        return (
            "当前没有断点快照。\n"
            "请先在 Android Studio 中运行项目并命中断点，"
            "确认 debuggerPlugin 已安装且 API Endpoint 配置为 http://localhost:8000/v1/debug/snapshot。"
        )

    items = list(snapshots)
    try:
        snap = items[index]
    except IndexError:
        snap = items[-1]

    received_at = snap.get("_received_at", 0)
    age = int(time.time() - received_at)

    # 格式化输出
    lines = [f"断点快照（{age}秒前接收，共 {len(items)} 条）"]
    lines.append("─" * 50)

    # 单断点格式
    if "snapshot" in snap:
        s = snap["snapshot"]
        lines.append(f"文件：{s.get('file', '?')}  行：{s.get('line', '?')}")
        lines.append(f"类：{s.get('className', '?')}  方法：{s.get('method', '?')}")
        lines.append("")
        lines.append("调用栈：")
        for frame in s.get("callStack", [])[:5]:
            lines.append(f"  {frame.get('className', '?')}.{frame.get('method', '?')}() L{frame.get('line', '?')}")
        lines.append("")
        lines.append("局部变量：")
        for var in s.get("variables", [])[:20]:
            children = var.get("children", [])
            if children:
                lines.append(f"  {var['name']}: {var['type']} = {var['value']}")
                for child in children[:5]:
                    lines.append(f"    .{child['name']}: {child['type']} = {child['value']}")
            else:
                lines.append(f"  {var['name']}: {var['type']} = {var['value']}")

    # 多断点 diff 格式
    elif "breakpoints" in snap:
        lines.append(f"会话：{snap.get('session', '?')}  断点数：{len(snap['breakpoints'])}")
        for bp in snap["breakpoints"][:3]:
            lines.append(f"\n断点 #{bp.get('id', '?')}：{bp.get('location', '?')}")
            key_vars = bp.get("keyVars", {})
            if key_vars:
                lines.append("  关键变量：" + ", ".join(f"{k}={v}" for k, v in list(key_vars.items())[:8]))
            diff = bp.get("diff_from_prev", {})
            if diff.get("changed"):
                lines.append("  变化：" + ", ".join(f"{k}: {v}" for k, v in diff["changed"].items()))
        if snap.get("callStackDiff"):
            lines.append(f"\n调用栈变化：{snap['callStackDiff']}")
    else:
        lines.append(json.dumps(snap, ensure_ascii=False, indent=2)[:2000])

    return "\n".join(lines)


tool_registry.register(ToolDefinition(
    name="get_debug_snapshot",
    description=(
        "获取 Android Studio 断点命中时采集的快照（局部变量、调用栈、文件位置）。"
        "需要先在 AS 中运行项目并命中断点，debuggerPlugin 会自动推送快照到后端。"
        "index=-1 获取最新快照，index=0 获取最早快照。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "index": {
                "type": "integer",
                "description": "快照索引，-1 表示最新，0 表示最早，默认 -1",
            }
        },
        "required": [],
    },
    handler=_get_debug_snapshot_handler,
))


# ── set_breakpoint ────────────────────────────────────────────────────────────

async def _set_breakpoint_handler(file: str, line: int, reason: str = "") -> str:
    """
    向 Android Studio 推送断点推荐。
    插件的 LobiCallbackServer 会接收并在 AS 中自动打断点。
    用户需要在 AS 中运行项目才能命中断点。
    """
    payload = {
        "recommendations": [
            {"file": file, "line": line, "reason": reason or f"Agent 建议在此处打断点"}
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(_LOBI_CALLBACK_URL, json=payload)
            if resp.is_success:
                return (
                    f"✅ 已向 Android Studio 推送断点推荐：{file}:{line}\n"
                    f"原因：{reason or '（未指定）'}\n\n"
                    f"请在 Android Studio 中运行项目，等待断点命中后使用 wait_for_breakpoint 工具获取结果。"
                )
            else:
                return f"⚠️ AS 插件返回错误：HTTP {resp.status_code}，请检查插件是否正常运行。"
    except httpx.ConnectError:
        return (
            "⚠️ 无法连接到 Android Studio 插件（18766端口无响应）。\n"
            "请确认：\n"
            "1. Android Studio 已打开项目\n"
            "2. debuggerPlugin 已安装并启用\n"
            "3. 插件的 LobiCallbackServer 已启动（查看 AS 日志中的 [AIDebugger] 输出）"
        )
    except Exception as e:
        logger.error("set_breakpoint failed | error=%s", e)
        return f"[错误] 推送断点失败：{e}"


tool_registry.register(ToolDefinition(
    name="set_breakpoint",
    description=(
        "向 Android Studio 推送断点推荐，让插件在指定文件和行号自动打断点。"
        "推送后需要用户在 AS 中运行项目，断点命中后使用 wait_for_breakpoint 工具等待结果。"
        "file 参数只需文件名（如 ImageCompressor.kt），不需要完整路径。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "file": {
                "type": "string",
                "description": "文件名（如 ImageCompressor.kt）",
            },
            "line": {
                "type": "integer",
                "description": "行号（从 1 开始）",
            },
            "reason": {
                "type": "string",
                "description": "打断点的原因（可选，帮助用户理解）",
            },
        },
        "required": ["file", "line"],
    },
    handler=_set_breakpoint_handler,
))


# ── wait_for_breakpoint ───────────────────────────────────────────────────────

async def _wait_for_breakpoint_handler(timeout_seconds: int = 120) -> str:
    """
    等待新断点快照到来。
    用户负责在 AS 中运行项目，Agent 通过此工具等待断点命中结果。
    超时后返回提示，不阻塞后续操作。
    """
    snapshots = _get_snapshots()
    # 记录当前快照数量，等待新增
    count_before = len(snapshots)
    deadline = time.time() + min(timeout_seconds, 180)  # 最多等 3 分钟

    logger.info("wait_for_breakpoint | timeout=%ds count_before=%d", timeout_seconds, count_before)

    while time.time() < deadline:
        await asyncio.sleep(2)
        current_count = len(_get_snapshots())
        if current_count > count_before:
            # 有新快照
            return await _get_debug_snapshot_handler(index=-1)

    return (
        f"⏰ 等待超时（{timeout_seconds}秒）。\n"
        "断点未命中，可能的原因：\n"
        "1. 项目未运行或未执行到断点所在代码路径\n"
        "2. 断点位置不正确\n"
        "3. debuggerPlugin 未正确推送快照\n\n"
        "你可以：\n"
        "- 使用 get_debug_snapshot 查看已有快照\n"
        "- 使用 set_breakpoint 重新推送断点推荐\n"
        "- 再次调用 wait_for_breakpoint 继续等待"
    )


tool_registry.register(ToolDefinition(
    name="wait_for_breakpoint",
    description=(
        "等待 Android Studio 断点命中并返回快照结果。"
        "调用此工具后，Agent 会轮询等待新的断点快照到来（用户需要在 AS 中运行项目）。"
        "timeout_seconds 控制最长等待时间（默认 120 秒，最多 180 秒）。"
        "超时后会给出提示，不会阻塞后续操作。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "timeout_seconds": {
                "type": "integer",
                "description": "最长等待时间（秒），默认 120，最多 180",
            }
        },
        "required": [],
    },
    handler=_wait_for_breakpoint_handler,
))

logger.info("debug_tools registered | get_debug_snapshot, set_breakpoint, wait_for_breakpoint")
