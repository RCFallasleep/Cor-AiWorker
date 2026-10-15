from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

import pytest

from cor_aiworker.storage.db import Database, DatabaseTooNewError, load_migrations


async def test_pragmas_are_applied(db: Database) -> None:
    for pragma, expected in [("journal_mode", "wal"), ("foreign_keys", 1), ("busy_timeout", 5000)]:
        row = await db.fetchone(f"PRAGMA {pragma}")
        assert row is not None
        assert row[0] == expected


async def test_migrations_bring_schema_to_latest(db: Database) -> None:
    assert await db.schema_version() == load_migrations()[-1][0]
    tables = {r["name"] for r in await db.fetchall("SELECT name FROM sqlite_master")}
    assert {"sessions", "messages", "runs", "run_events", "mcp_servers", "tool_policies"} <= tables


async def test_reopening_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "a.db"
    first = await Database.open(path)
    version = await first.schema_version()
    await first.close()
    second = await Database.open(path)
    assert await second.schema_version() == version
    await second.close()


async def test_refuses_database_from_newer_program(tmp_path: Path) -> None:
    path = tmp_path / "future.db"
    with sqlite3.connect(path) as conn:
        conn.execute("PRAGMA user_version = 999")
    with pytest.raises(DatabaseTooNewError):
        await Database.open(path)


async def test_transaction_rolls_back_on_error(db: Database) -> None:
    with pytest.raises(RuntimeError):
        async with db.transaction() as conn:
            await conn.execute("INSERT INTO tool_policies VALUES ('t', 'allow', 'now')")
            raise RuntimeError("中途失败")
    assert await db.fetchall("SELECT * FROM tool_policies") == []


async def test_check_constraints_reject_invalid_values(db: Database) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        async with db.transaction() as conn:
            await conn.execute("INSERT INTO tool_policies VALUES ('t', 'maybe', 'now')")


async def test_concurrent_transactions_do_not_interleave(db: Database) -> None:
    """两个任务并发写入，其中一个回滚，不能连带丢掉另一个的数据。"""

    async def good(i: int) -> None:
        async with db.transaction() as conn:
            await conn.execute("INSERT INTO tool_policies VALUES (?, 'allow', 'now')", (f"g{i}",))
            await asyncio.sleep(0)

    async def bad() -> None:
        async with db.transaction() as conn:
            await conn.execute("INSERT INTO tool_policies VALUES ('bad', 'allow', 'now')")
            await asyncio.sleep(0)
            raise RuntimeError

    results = await asyncio.gather(
        *(good(i) for i in range(5)),
        bad(),
        *(good(i) for i in range(5, 10)),
        return_exceptions=True,
    )
    assert sum(isinstance(r, RuntimeError) for r in results) == 1
    names = {r["tool_name"] for r in await db.fetchall("SELECT tool_name FROM tool_policies")}
    assert names == {f"g{i}" for i in range(10)}
