"""Agent 循环（docs/ARCHITECTURE.md 第三章）。

模型提出工具调用 → 校验 → 权限决策 / 审批 → 执行 → 结果回传 → 再调用模型，
直到模型不再调用工具。循环只产出事件，不直接打印、不直接写库（ADR-003）。
"""

from __future__ import annotations

import json
import time
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from .events import (
    ApprovalRequested,
    ApprovalResolved,
    HistoryAppended,
    RunEvent,
    RunFinished,
    RunStarted,
    ToolCallRequested,
    ToolResultReady,
    TurnFinished,
)
from .permissions import ApprovalGate, ApprovalRequest, PermissionPolicy
from .providers.base import Provider
from .tools.registry import ToolRegistry
from .types import NativeMessage, ToolCall, ToolResult, TurnResult, Usage


@dataclass
class Conversation:
    """一个会话：绑定的 Provider 与原生格式的历史（ADR-002）。"""

    provider: Provider
    history: list[NativeMessage] = field(default_factory=list)


@dataclass(frozen=True)
class LoopConfig:
    max_turns: int = 20
    max_identical_calls: int = 3


async def run(
    conversation: Conversation,
    user_input: str,
    *,
    system: str,
    tools: ToolRegistry,
    policy: PermissionPolicy,
    gate: ApprovalGate,
    config: LoopConfig | None = None,
) -> AsyncIterator[RunEvent]:
    config = config or LoopConfig()
    provider = conversation.provider
    started = time.monotonic()
    totals = Usage()
    seen: Counter[str] = Counter()
    tainted = False  # 本次运行是否读取过外部内容（ADR-005）
    turns = tool_calls = 0
    stop = "max_turns"

    yield RunStarted(provider=provider.name, model=provider.model)

    # 历史自愈：上次运行在工具执行前被中断，补上结果，否则 API 会拒绝这段历史
    dangling = provider.unanswered_tool_calls(conversation.history)
    if dangling:
        healed = [ToolResult(i, "已取消：上次运行在工具执行前被中断", True) for i in dangling]
        yield _append(conversation, provider.tool_result_messages(healed))

    yield _append(conversation, [provider.user_message(user_input)])

    for _ in range(config.max_turns):
        result: TurnResult | None = None
        async for item in provider.stream(system, conversation.history, tools.specs()):
            if isinstance(item, TurnResult):
                result = item
            else:
                yield item
        if result is None:
            raise RuntimeError(f"{provider.name} 未返回本轮结果")

        turns += 1
        totals.add(result.usage)
        yield _append(conversation, result.messages)
        yield TurnFinished(turn=turns, stop=result.stop, usage=result.usage)

        if result.stop != "tool_calls" or not result.tool_calls:
            if result.tool_calls:
                # 被截断或拒答的回合里，工具调用可能不完整，一律不执行，但要补上结果
                skipped = [
                    ToolResult(c.id, f"未执行：本轮以 {result.stop} 结束", True)
                    for c in result.tool_calls
                ]
                yield _append(conversation, provider.tool_result_messages(skipped))
            stop = result.stop
            break

        results: list[ToolResult] = []
        for call in result.tool_calls:
            tool_calls += 1
            risk = tools.risk(call.name)
            yield ToolCallRequested(call=call, risk=risk)

            outcome = _precheck(call, tools, seen, config)
            if outcome is None:
                decision = policy.decide(call.name, risk, tainted=tainted)
                if decision.decision == "deny":
                    outcome = ToolResult(call.id, decision.reason, True)
                elif decision.decision == "ask":
                    approval = ApprovalRequest(uuid.uuid4().hex, call, risk, decision.reason)
                    yield ApprovalRequested(
                        approval_id=approval.id,
                        call_id=call.id,
                        tool_name=call.name,
                        risk=risk,
                        reason=decision.reason,
                    )
                    approved = await gate.request(approval)
                    yield ApprovalResolved(approval_id=approval.id, approved=approved)
                    if not approved:
                        outcome = ToolResult(call.id, "用户拒绝了这次工具调用。", True)

            untrusted = False
            if outcome is None:
                outcome = await tools.call(call)
                untrusted = tools.is_untrusted(call.name)
                tainted = tainted or untrusted

            yield ToolResultReady(
                call_id=call.id,
                tool_name=call.name,
                content=outcome.content,
                is_error=outcome.is_error,
                untrusted=untrusted,
            )
            results.append(outcome)

        yield _append(conversation, provider.tool_result_messages(results))

    yield RunFinished(
        stop=stop,
        turns=turns,
        tool_calls=tool_calls,
        usage=totals,
        elapsed=time.monotonic() - started,
    )


def _precheck(
    call: ToolCall, tools: ToolRegistry, seen: Counter[str], config: LoopConfig
) -> ToolResult | None:
    """在权限决策之前就能判定失败的情况；返回 None 表示通过。"""
    if not tools.has(call.name):
        return ToolResult(call.id, f"未知工具：{call.name}", True)
    if call.arguments is None:
        return ToolResult(call.id, json.dumps({"INVALID_JSON": call.raw_arguments}), True)
    key = f"{call.name}:{json.dumps(call.arguments, sort_keys=True)}"
    seen[key] += 1
    if seen[key] > config.max_identical_calls:
        return ToolResult(call.id, "相同参数的调用已重复多次，请换一种方法或直接回答。", True)
    return None


def _append(conversation: Conversation, messages: list[NativeMessage]) -> HistoryAppended:
    conversation.history.extend(messages)
    return HistoryAppended(messages=messages)
