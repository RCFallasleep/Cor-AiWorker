"""Agent 循环：模型提出工具调用 → 审批 → 执行 → 结果回传 → 再调用模型，直到不再调用工具。"""

from __future__ import annotations

import json
import time
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from .tools import ToolRegistry
from .types import Provider, Risk, StopReason, StreamHandler, ToolCall, ToolResult, Usage

# 审批回调：返回 True 表示允许执行
Approver = Callable[[ToolCall, Risk], Awaitable[bool]]

MAX_IDENTICAL_CALLS = 3


@dataclass
class RunStats:
    turns: int = 0
    tool_calls: int = 0
    usage: Usage = field(default_factory=Usage)
    elapsed: float = 0.0
    stop: StopReason | str = ""


async def run_agent(
    provider: Provider,
    registry: ToolRegistry,
    system: str,
    user_input: str,
    handler: StreamHandler,
    approve: Approver,
    max_turns: int = 10,
) -> RunStats:
    stats = RunStats()
    started = time.monotonic()
    seen: Counter[str] = Counter()
    provider.add_user_message(user_input)

    for _ in range(max_turns):
        result = await provider.stream_turn(system, registry.specs(), handler)
        stats.turns += 1
        stats.usage.add(result.usage)

        if result.stop != "tool_calls" or not result.tool_calls:
            if result.tool_calls:
                # 被截断或拒答时，未完成的工具调用一律不执行；
                # 但历史里已有 tool_use，必须补上结果，否则下一轮请求会被拒绝
                provider.add_tool_results(
                    [
                        ToolResult(c.id, f"未执行：本轮以 {result.stop} 结束", True)
                        for c in result.tool_calls
                    ]
                )
            stats.stop = result.stop
            break

        results: list[ToolResult] = []
        for call in result.tool_calls:
            stats.tool_calls += 1
            handler.on_tool_call(call)
            outcome = await _execute(call, registry, approve, seen)
            handler.on_tool_result(call, outcome)
            results.append(outcome)
        provider.add_tool_results(results)
    else:
        stats.stop = "max_turns"

    stats.elapsed = time.monotonic() - started
    return stats


async def _execute(
    call: ToolCall, registry: ToolRegistry, approve: Approver, seen: Counter[str]
) -> ToolResult:
    if call.arguments is None:
        return ToolResult(call.id, json.dumps({"INVALID_JSON": call.raw_arguments}), True)

    key = f"{call.name}:{json.dumps(call.arguments, sort_keys=True)}"
    seen[key] += 1
    if seen[key] > MAX_IDENTICAL_CALLS:
        return ToolResult(call.id, "相同参数的调用已重复多次，请换一种方法或直接回答。", True)

    if not await approve(call, registry.risk(call.name)):
        return ToolResult(call.id, "用户拒绝了这次工具调用。", True)
    return await registry.call(call.id, call.name, call.arguments)
