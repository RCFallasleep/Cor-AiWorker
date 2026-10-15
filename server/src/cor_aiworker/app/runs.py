"""运行管理（docs/ARCHITECTURE.md 第三章，ADR-003、ADR-004）。

- 运行是后台任务，不随订阅者断开而中止，只能显式取消
- 每个事件分配一个序号，实时推送与写入运行日志的内容完全一致
- 运行中的事件保存在内存里供订阅；结束后从数据库回放
- 流式片段逐条记录，但批量写入数据库，减少写入次数
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, cast

from ..kernel.context import Environment, build_system_prompt
from ..kernel.events import (
    ApprovalRequested,
    HistoryAppended,
    RunEvent,
    RunFailed,
    RunFinished,
    TextDelta,
    ThinkingDelta,
    event_to_dict,
)
from ..kernel.loop import Conversation, LoopConfig
from ..kernel.loop import run as run_loop
from ..kernel.permissions import ApprovalRequest, Decision, PermissionPolicy
from ..kernel.tools.registry import ToolRegistry
from ..storage.runs import RunStore, RunTotals
from ..storage.sessions import SessionStore
from ..storage.settings import SettingsStore
from .providers import ProviderFactory

logger = logging.getLogger(__name__)

FLUSH_INTERVAL = 0.5  # 流式片段最多在内存里攒多久再写库（秒）
FLUSH_BATCH = 64  # 或攒够多少条
_DECISIONS = frozenset({"allow", "ask", "deny"})


class SessionNotFoundError(LookupError):
    pass


class RunNotFoundError(LookupError):
    pass


class SessionBusyError(RuntimeError):
    """同一会话同时只能有一个运行，否则两次运行的历史会交错。"""


@dataclass(frozen=True)
class PublishedEvent:
    seq: int
    type: str
    payload: dict[str, Any]


class _ActiveRun:
    def __init__(self, run_id: str, session_id: str) -> None:
        self.run_id = run_id
        self.session_id = session_id
        self.task: asyncio.Task[None] | None = None
        self.events: list[PublishedEvent] = []
        self.done = False
        self.changed = asyncio.Condition()
        self.unsaved: list[tuple[int, dict[str, Any]]] = []
        self.last_flush = time.monotonic()
        # 审批：已向界面发出、尚未答复的审批 id；内核正在等待的 future；提前到达的答复
        self.awaiting: set[str] = set()
        self.waiters: dict[str, asyncio.Future[bool]] = {}
        self.early_answers: dict[str, bool] = {}


class _ApprovalGate:
    """内核的审批闸门：挂起等待，直到界面调用 RunManager.resolve_approval。"""

    def __init__(self, active: _ActiveRun) -> None:
        self._active = active

    async def request(self, approval: ApprovalRequest) -> bool:
        if approval.id in self._active.early_answers:
            return self._active.early_answers.pop(approval.id)
        future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self._active.waiters[approval.id] = future
        try:
            return await future
        finally:
            self._active.waiters.pop(approval.id, None)


class RunManager:
    def __init__(
        self,
        *,
        sessions: SessionStore,
        runs: RunStore,
        settings: SettingsStore,
        tools: ToolRegistry,
        provider_factory: ProviderFactory,
        loop_config: LoopConfig | None = None,
    ) -> None:
        self._sessions = sessions
        self._runs = runs
        self._settings = settings
        self._tools = tools
        self._provider_factory = provider_factory
        self._loop_config = loop_config
        self._active: dict[str, _ActiveRun] = {}
        self._busy_sessions: set[str] = set()

    # ── 对外接口 ────────────────────────────────────────────────────────────

    async def start(self, session_id: str, user_input: str) -> str:
        """启动一次运行并立即返回运行 id；运行在后台继续。"""
        # 先占位再 await，避免两个并发请求同时通过检查
        if session_id in self._busy_sessions:
            raise SessionBusyError(f"会话 {session_id} 正在运行中")
        self._busy_sessions.add(session_id)
        try:
            session = await self._sessions.get(session_id)
            if session is None:
                raise SessionNotFoundError(session_id)
            provider = self._provider_factory(session)
            history = await self._sessions.load_messages(session_id)
            policy = PermissionPolicy(await self._policy_overrides())
            record = await self._runs.start(session_id, user_input)
        except BaseException:
            self._busy_sessions.discard(session_id)
            raise

        active = _ActiveRun(record.id, session_id)
        self._active[record.id] = active
        active.task = asyncio.create_task(
            self._execute(active, Conversation(provider, history), user_input, policy),
            name=f"run-{record.id}",
        )
        return record.id

    async def subscribe(self, run_id: str, *, after_seq: int = 0) -> AsyncIterator[PublishedEvent]:
        """订阅运行事件，直到运行结束。after_seq 用于断线重连后只补发错过的部分。"""
        active = self._active.get(run_id)
        if active is None:
            if await self._runs.get(run_id) is None:
                raise RunNotFoundError(run_id)
            for record in await self._runs.events(run_id, after_seq=after_seq):
                yield PublishedEvent(record.seq, record.type, record.payload)
            return

        position = max(after_seq, 0)
        while True:
            async with active.changed:
                while len(active.events) <= position and not active.done:
                    await active.changed.wait()
                batch = active.events[position:]
                finished = active.done
            for item in batch:
                yield item
            position += len(batch)
            if finished and position >= len(active.events):
                return

    def resolve_approval(self, run_id: str, approval_id: str, approved: bool) -> bool:
        """答复一个审批请求；请求不存在或已答复时返回 False。"""
        active = self._active.get(run_id)
        if active is None or approval_id not in active.awaiting:
            return False
        active.awaiting.discard(approval_id)
        waiter = active.waiters.get(approval_id)
        if waiter is not None and not waiter.done():
            waiter.set_result(approved)
        else:
            active.early_answers[approval_id] = approved
        return True

    async def cancel(self, run_id: str) -> bool:
        active = self._active.get(run_id)
        if active is None or active.task is None:
            return False
        active.task.cancel()
        # 用 wait 而不是 await task：后者会把被取消任务的 CancelledError 抛给调用方
        await asyncio.wait({active.task})
        return True

    def active_run(self, session_id: str) -> str | None:
        return next((a.run_id for a in self._active.values() if a.session_id == session_id), None)

    async def shutdown(self) -> None:
        """进程退出前调用：取消所有运行，并等待它们完成收尾（写入取消状态）。"""
        tasks = [a.task for a in self._active.values() if a.task is not None]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(tasks)

    # ── 运行过程 ────────────────────────────────────────────────────────────

    async def _execute(
        self,
        active: _ActiveRun,
        conversation: Conversation,
        user_input: str,
        policy: PermissionPolicy,
    ) -> None:
        system = build_system_prompt(Environment.current())
        try:
            async for event in run_loop(
                conversation,
                user_input,
                system=system,
                tools=self._tools,
                policy=policy,
                gate=_ApprovalGate(active),
                config=self._loop_config,
            ):
                if isinstance(event, HistoryAppended):
                    await self._sessions.append_messages(
                        active.session_id, event.messages, run_id=active.run_id
                    )
                    continue
                if isinstance(event, ApprovalRequested):
                    active.awaiting.add(event.approval_id)
                await self._publish(active, event)
                if isinstance(event, RunFinished):
                    await self._flush(active)
                    await self._runs.finish(active.run_id, _totals(event))
        except asyncio.CancelledError:
            await self._record_failure(active, "运行已取消", cancelled=True)
            raise
        except Exception as exc:
            logger.exception("运行失败 run_id=%s", active.run_id)
            await self._record_failure(active, f"{type(exc).__name__}: {exc}", cancelled=False)
        finally:
            await self._flush(active)
            async with active.changed:
                active.done = True
                active.changed.notify_all()
            # 先写完数据库、再移出活动列表：此后的订阅者从数据库回放，能拿到完整事件
            self._active.pop(active.run_id, None)
            self._busy_sessions.discard(active.session_id)

    async def _publish(self, active: _ActiveRun, event: RunEvent) -> None:
        payload = event_to_dict(event)
        async with active.changed:
            record = PublishedEvent(len(active.events) + 1, event.type, payload)
            active.events.append(record)
            active.changed.notify_all()
        active.unsaved.append((record.seq, payload))

        is_delta = isinstance(event, TextDelta | ThinkingDelta)
        if (
            not is_delta
            or len(active.unsaved) >= FLUSH_BATCH
            or time.monotonic() - active.last_flush >= FLUSH_INTERVAL
        ):
            await self._flush(active)

    async def _flush(self, active: _ActiveRun) -> None:
        if not active.unsaved:
            return
        batch, active.unsaved = active.unsaved, []
        active.last_flush = time.monotonic()
        await self._runs.append_events(active.run_id, batch)

    async def _record_failure(self, active: _ActiveRun, error: str, *, cancelled: bool) -> None:
        await self._publish(active, RunFailed(error=error))
        await self._runs.fail(active.run_id, error=error, cancelled=cancelled)

    async def _policy_overrides(self) -> dict[str, Decision]:
        stored = await self._settings.tool_policies()
        return {tool: cast(Decision, d) for tool, d in stored.items() if d in _DECISIONS}


def _totals(event: RunFinished) -> RunTotals:
    return RunTotals(
        stop=event.stop,
        turns=event.turns,
        tool_calls=event.tool_calls,
        input_tokens=event.usage.input_tokens,
        output_tokens=event.usage.output_tokens,
        cache_read_tokens=event.usage.cache_read_tokens,
        cache_write_tokens=event.usage.cache_write_tokens,
    )
