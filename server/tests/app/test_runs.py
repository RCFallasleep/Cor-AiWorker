from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import pytest

from cor_aiworker.app.providers import MissingApiKeyError, ProviderFactory
from cor_aiworker.app.runs import (
    PublishedEvent,
    RunManager,
    RunNotFoundError,
    SessionBusyError,
)
from cor_aiworker.kernel.providers.base import Provider, ProviderEvent
from cor_aiworker.kernel.tools.registry import ToolOutput, ToolRegistry
from cor_aiworker.kernel.types import JSON, NativeMessage, ToolSpec
from cor_aiworker.storage.db import Database
from cor_aiworker.storage.runs import RunStore
from cor_aiworker.storage.sessions import SessionRecord, SessionStore
from cor_aiworker.storage.settings import SettingsStore
from tests.kernel.fakes import FakeProvider, call, turn

TIMEOUT = 5


class CountingTool:
    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, arguments: JSON) -> ToolOutput:
        self.calls += 1
        return ToolOutput("网页内容")


class BrokenProvider(FakeProvider):
    async def stream(
        self, system: str, history: list[NativeMessage], tools: list[ToolSpec]
    ) -> AsyncIterator[ProviderEvent]:
        raise ConnectionError("模型服务不可用")
        yield  # pragma: no cover  让函数成为异步生成器


@dataclass
class Harness:
    db: Database
    sessions: SessionStore
    runs: RunStore
    settings: SettingsStore
    tools: ToolRegistry
    fetch: CountingTool

    def manager(self, provider: Provider) -> RunManager:
        return self.manager_with_factory(lambda _: provider)

    def manager_with_factory(self, factory: ProviderFactory) -> RunManager:
        return RunManager(
            sessions=self.sessions,
            runs=self.runs,
            settings=self.settings,
            tools=self.tools,
            provider_factory=factory,
        )

    async def new_session(self) -> SessionRecord:
        return await self.sessions.create(provider="fake", model="fake-1")


@pytest.fixture
async def harness(tmp_path: Path) -> AsyncIterator[Harness]:
    db = await Database.open(tmp_path / "t.db")
    tools = ToolRegistry()
    fetch = CountingTool()
    tools.register(
        ToolSpec("fetch", "抓取网页", {"type": "object"}), fetch, risk="network", untrusted=True
    )
    yield Harness(db, SessionStore(db), RunStore(db), SettingsStore(db), tools, fetch)
    await db.close()


async def drain(manager: RunManager, run_id: str, after_seq: int = 0) -> list[PublishedEvent]:
    async with asyncio.timeout(TIMEOUT):
        return [e async for e in manager.subscribe(run_id, after_seq=after_seq)]


async def until(manager: RunManager, run_id: str, event_type: str) -> PublishedEvent:
    async with asyncio.timeout(TIMEOUT):
        async for event in manager.subscribe(run_id):
            if event.type == event_type:
                return event
    raise AssertionError(f"运行结束前没有出现 {event_type}")


# ── 正常流程 ────────────────────────────────────────────────────────────────


async def test_run_persists_history_events_and_totals(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(FakeProvider([turn(text="你好")]))

    run_id = await manager.start(session.id, "在吗")
    events = await drain(manager, run_id)

    assert [e.type for e in events] == [
        "run_started",
        "text_delta",
        "turn_finished",
        "run_finished",
    ]
    assert [e.seq for e in events] == [1, 2, 3, 4]
    record = await harness.runs.get(run_id)
    assert record is not None
    assert (record.status, record.stop, record.turns, record.input_tokens) == (
        "finished",
        "end",
        1,
        10,
    )
    history = await harness.sessions.load_messages(session.id)
    assert [m["role"] for m in history] == ["user", "assistant"]


async def test_live_events_equal_replayed_events(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(FakeProvider([turn(call("fetch")), turn(text="完成")]))
    await harness.settings.set_tool_policy("fetch", "allow")

    run_id = await manager.start(session.id, "读网页")
    live = await drain(manager, run_id)
    replayed = await drain(manager, run_id)  # 运行已结束，这次来自数据库

    assert manager.active_run(session.id) is None
    assert replayed == live


async def test_subscribe_resumes_after_seq(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(FakeProvider([turn(text="你好")]))
    run_id = await manager.start(session.id, "在吗")
    full = await drain(manager, run_id)
    assert await drain(manager, run_id, after_seq=2) == full[2:]


async def test_second_run_sees_previous_history(harness: Harness) -> None:
    session = await harness.new_session()
    provider = FakeProvider([turn(text="一"), turn(text="二")])
    manager = harness.manager(provider)

    await drain(manager, await manager.start(session.id, "第一个问题"))
    await drain(manager, await manager.start(session.id, "第二个问题"))

    second = provider.seen_histories[1]
    assert [m.get("text") for m in second] == ["第一个问题", "一", "第二个问题"]


async def test_stored_tool_policy_is_applied(harness: Harness) -> None:
    session = await harness.new_session()
    await harness.settings.set_tool_policy("fetch", "deny")
    manager = harness.manager(FakeProvider([turn(call("fetch")), turn(text="好的")]))

    events = await drain(manager, await manager.start(session.id, "读网页"))

    assert harness.fetch.calls == 0
    assert "approval_requested" not in [e.type for e in events]


# ── 审批 ──────────────────────────────────────────────────────────────────


async def test_approval_answered_before_and_after_kernel_waits(harness: Harness) -> None:
    session = await harness.new_session()
    provider = FakeProvider(
        [turn(call("fetch", {"n": 1}, "a")), turn(call("fetch", {"n": 2}, "b")), turn(text="完成")]
    )
    manager = harness.manager(provider)
    run_id = await manager.start(session.id, "读两个网页")

    approvals: list[str] = []
    async with asyncio.timeout(TIMEOUT):
        async for event in manager.subscribe(run_id):
            if event.type == "approval_requested":
                approval_id = event.payload["approval_id"]
                approvals.append(approval_id)
                if len(approvals) == 2:
                    await asyncio.sleep(0.05)  # 第二次：确保内核已在等待
                assert manager.resolve_approval(run_id, approval_id, True)
                assert not manager.resolve_approval(run_id, approval_id, True)  # 不能重复答复

    assert len(approvals) == 2
    assert harness.fetch.calls == 2
    record = await harness.runs.get(run_id)
    assert record is not None and record.status == "finished"


async def test_denied_approval_skips_tool(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(FakeProvider([turn(call("fetch")), turn(text="好的")]))
    run_id = await manager.start(session.id, "读网页")

    event = await until(manager, run_id, "approval_requested")
    manager.resolve_approval(run_id, event.payload["approval_id"], False)
    events = await drain(manager, run_id)

    assert harness.fetch.calls == 0
    [result] = [e for e in events if e.type == "tool_result"]
    assert result.payload["is_error"]


async def test_unknown_approval_is_rejected(harness: Harness) -> None:
    manager = harness.manager(FakeProvider([]))
    assert not manager.resolve_approval("no-run", "no-approval", True)


# ── 取消与异常 ──────────────────────────────────────────────────────────────


async def test_cancel_during_approval_then_next_run_heals(harness: Harness) -> None:
    session = await harness.new_session()
    provider = FakeProvider([turn(call("fetch", call_id="old")), turn(text="好的")])
    manager = harness.manager(provider)

    run_id = await manager.start(session.id, "读网页")
    await until(manager, run_id, "approval_requested")
    assert await manager.cancel(run_id)

    record = await harness.runs.get(run_id)
    assert record is not None and record.status == "cancelled"
    assert (await drain(manager, run_id))[-1].type == "run_failed"
    assert manager.active_run(session.id) is None

    # 中断时历史停在「有工具调用、没有结果」，下一次运行开始前应自动补上
    await drain(manager, await manager.start(session.id, "算了"))
    healed = provider.seen_histories[1][2]
    assert healed["role"] == "tool_results"
    assert healed["results"][0]["id"] == "old"


async def test_provider_error_marks_run_failed(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(BrokenProvider([]))

    run_id = await manager.start(session.id, "在吗")
    events = await drain(manager, run_id)

    assert events[-1].type == "run_failed"
    assert "模型服务不可用" in events[-1].payload["error"]
    record = await harness.runs.get(run_id)
    assert record is not None and record.status == "failed"
    assert manager.active_run(session.id) is None


async def test_shutdown_cancels_active_runs(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(FakeProvider([turn(call("fetch"))]))
    run_id = await manager.start(session.id, "读网页")
    await until(manager, run_id, "approval_requested")

    await manager.shutdown()

    record = await harness.runs.get(run_id)
    assert record is not None and record.status == "cancelled"


# ── 边界情况 ────────────────────────────────────────────────────────────────


async def test_session_allows_one_run_at_a_time(harness: Harness) -> None:
    session = await harness.new_session()
    manager = harness.manager(FakeProvider([turn(call("fetch")), turn(text="好的")]))
    run_id = await manager.start(session.id, "读网页")

    with pytest.raises(SessionBusyError):
        await manager.start(session.id, "再来一个")
    assert manager.active_run(session.id) == run_id
    await manager.cancel(run_id)


async def test_missing_api_key_leaves_no_trace(harness: Harness) -> None:
    session = await harness.new_session()

    def no_key(record: SessionRecord) -> Provider:
        raise MissingApiKeyError(record.provider)

    manager = harness.manager_with_factory(no_key)
    with pytest.raises(MissingApiKeyError):
        await manager.start(session.id, "在吗")
    assert await harness.runs.for_session(session.id) == []
    assert manager.active_run(session.id) is None
    with pytest.raises(MissingApiKeyError):  # 不会被误判为「会话忙」
        await manager.start(session.id, "在吗")


async def test_subscribe_unknown_run(harness: Harness) -> None:
    manager = harness.manager(FakeProvider([]))
    with pytest.raises(RunNotFoundError):
        await drain(manager, "missing")
