"""运行与运行日志（事件）。"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from .db import Database, dump_json, now

RunStatus = Literal["running", "finished", "failed", "cancelled"]


@dataclass(frozen=True)
class RunTotals:
    stop: str
    turns: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int


@dataclass(frozen=True)
class RunRecord:
    id: str
    session_id: str
    status: RunStatus
    user_input: str
    stop: str | None
    error: str | None
    turns: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    started_at: str
    finished_at: str | None


@dataclass(frozen=True)
class EventRecord:
    run_id: str
    seq: int
    type: str
    payload: dict[str, Any]
    created_at: str


def _run(row: sqlite3.Row) -> RunRecord:
    return RunRecord(
        id=row["id"],
        session_id=row["session_id"],
        status=row["status"],
        user_input=row["user_input"],
        stop=row["stop"],
        error=row["error"],
        turns=row["turns"],
        tool_calls=row["tool_calls"],
        input_tokens=row["input_tokens"],
        output_tokens=row["output_tokens"],
        cache_read_tokens=row["cache_read_tokens"],
        cache_write_tokens=row["cache_write_tokens"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


class RunStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def start(self, session_id: str, user_input: str) -> RunRecord:
        record = RunRecord(
            id=uuid.uuid4().hex,
            session_id=session_id,
            status="running",
            user_input=user_input,
            stop=None,
            error=None,
            turns=0,
            tool_calls=0,
            input_tokens=0,
            output_tokens=0,
            cache_read_tokens=0,
            cache_write_tokens=0,
            started_at=now(),
            finished_at=None,
        )
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO runs (id, session_id, status, user_input, started_at)"
                " VALUES (?, ?, 'running', ?, ?)",
                (record.id, session_id, user_input, record.started_at),
            )
        return record

    async def finish(self, run_id: str, totals: RunTotals) -> None:
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE runs SET status = 'finished', stop = ?, turns = ?, tool_calls = ?,"
                " input_tokens = ?, output_tokens = ?, cache_read_tokens = ?,"
                " cache_write_tokens = ?, finished_at = ? WHERE id = ?",
                (
                    totals.stop,
                    totals.turns,
                    totals.tool_calls,
                    totals.input_tokens,
                    totals.output_tokens,
                    totals.cache_read_tokens,
                    totals.cache_write_tokens,
                    now(),
                    run_id,
                ),
            )

    async def fail(self, run_id: str, *, error: str, cancelled: bool = False) -> None:
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE runs SET status = ?, error = ?, finished_at = ? WHERE id = ?",
                ("cancelled" if cancelled else "failed", error, now(), run_id),
            )

    async def recover_interrupted(self) -> int:
        """启动时调用：上次进程退出时仍在运行的记录，标记为已取消。返回处理条数。"""
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "UPDATE runs SET status = 'cancelled', error = '本地服务在运行中退出',"
                " finished_at = ? WHERE status = 'running'",
                (now(),),
            )
            return cursor.rowcount

    async def get(self, run_id: str) -> RunRecord | None:
        row = await self._db.fetchone("SELECT * FROM runs WHERE id = ?", (run_id,))
        return _run(row) if row else None

    async def for_session(self, session_id: str) -> list[RunRecord]:
        rows = await self._db.fetchall(
            "SELECT * FROM runs WHERE session_id = ? ORDER BY started_at, id", (session_id,)
        )
        return [_run(r) for r in rows]

    async def append_events(self, run_id: str, events: list[dict[str, Any]]) -> list[int]:
        """按顺序追加事件，返回分配的序号。每个事件 dict 必须包含 "type"。"""
        if not events:
            return []
        timestamp = now()
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "SELECT COALESCE(MAX(seq), 0) FROM run_events WHERE run_id = ?", (run_id,)
            )
            row = await cursor.fetchone()
            start = int(row[0]) + 1 if row else 1
            seqs = list(range(start, start + len(events)))
            await conn.executemany(
                "INSERT INTO run_events (run_id, seq, type, payload, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                [
                    (run_id, seq, event["type"], dump_json(event), timestamp)
                    for seq, event in zip(seqs, events, strict=True)
                ],
            )
        return seqs

    async def events(self, run_id: str, *, after_seq: int = 0) -> list[EventRecord]:
        """读取运行日志；after_seq 用于断线重连后只补发错过的事件（ADR-004）。"""
        rows = await self._db.fetchall(
            "SELECT * FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq",
            (run_id, after_seq),
        )
        return [
            EventRecord(r["run_id"], r["seq"], r["type"], json.loads(r["payload"]), r["created_at"])
            for r in rows
        ]
