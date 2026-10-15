"""权限策略与审批（docs/ARCHITECTURE.md 4.3，ADR-005）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from .types import Risk, ToolCall

Decision = Literal["allow", "ask", "deny"]

DEFAULT_DECISIONS: dict[Risk, Decision] = {
    "read": "allow",
    "network": "ask",
    "write": "ask",
    "execute": "ask",
}

# 运行被外部内容污染后，这些风险等级的调用一律需要人确认，不受「总是允许」影响
TAINT_ESCALATED: frozenset[Risk] = frozenset({"write", "execute"})

_ASK_REASONS: dict[Risk, str] = {
    "read": "该工具已设置为每次询问",
    "network": "该工具会访问外部网络",
    "write": "该工具会修改本地文件或数据",
    "execute": "该工具会执行命令或代码",
}


@dataclass(frozen=True)
class PermissionDecision:
    decision: Decision
    reason: str


@dataclass
class PermissionPolicy:
    """默认按风险等级决定；overrides 按工具名覆盖。"""

    overrides: dict[str, Decision] = field(default_factory=dict)

    def decide(self, tool_name: str, risk: Risk, *, tainted: bool) -> PermissionDecision:
        configured = self.overrides.get(tool_name, DEFAULT_DECISIONS[risk])
        if configured == "deny":
            return PermissionDecision("deny", "该工具已被设置为禁止使用")
        if tainted and risk in TAINT_ESCALATED:
            return PermissionDecision("ask", "本次运行已读取外部内容，写入或执行类操作必须由你确认")
        if configured == "ask":
            return PermissionDecision("ask", _ASK_REASONS[risk])
        if tool_name in self.overrides:
            return PermissionDecision("allow", "已设置为总是允许")
        return PermissionDecision("allow", "只读工具，自动允许")


@dataclass(frozen=True)
class ApprovalRequest:
    id: str
    call: ToolCall
    risk: Risk
    reason: str


class ApprovalGate(Protocol):
    """审批闸门：内核声明，应用层实现（CLI 为终端输入，Web 为挂起等待 UI 回调）。"""

    async def request(self, approval: ApprovalRequest) -> bool: ...
