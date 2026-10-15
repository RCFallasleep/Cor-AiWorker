from __future__ import annotations

import pytest

from cor_aiworker.kernel.permissions import Decision, PermissionPolicy
from cor_aiworker.kernel.types import Risk


@pytest.mark.parametrize(
    ("risk", "tainted", "expected"),
    [
        ("read", False, "allow"),
        ("read", True, "allow"),
        ("network", False, "ask"),
        ("network", True, "ask"),
        ("write", False, "ask"),
        ("write", True, "ask"),
        ("execute", False, "ask"),
        ("execute", True, "ask"),
    ],
)
def test_defaults(risk: Risk, tainted: bool, expected: Decision) -> None:
    assert PermissionPolicy().decide("t", risk, tainted=tainted).decision == expected


@pytest.mark.parametrize(
    ("risk", "tainted", "expected"),
    [
        ("network", True, "allow"),  # 联网工具可被设为总是允许（残余风险见 ADR-005）
        ("write", False, "allow"),
        ("write", True, "ask"),  # 污染后写入强制审批，不可被覆盖
        ("execute", True, "ask"),
    ],
)
def test_always_allow_override(risk: Risk, tainted: bool, expected: Decision) -> None:
    policy = PermissionPolicy({"t": "allow"})
    assert policy.decide("t", risk, tainted=tainted).decision == expected


def test_deny_wins_even_for_read() -> None:
    assert PermissionPolicy({"t": "deny"}).decide("t", "read", tainted=False).decision == "deny"


def test_override_only_applies_to_named_tool() -> None:
    policy = PermissionPolicy({"other": "allow"})
    assert policy.decide("t", "write", tainted=False).decision == "ask"
