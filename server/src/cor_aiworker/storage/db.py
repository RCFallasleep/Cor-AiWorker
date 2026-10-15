"""数据库连接与迁移。

本地服务是单进程，全程共用一个连接；所有读写都经过同一把锁，
保证一个任务的事务不会混入另一个任务的语句。
"""

from __future__ import annotations

import asyncio
import importlib.resources
import json
import re
import sqlite3
from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiosqlite

MIGRATIONS_PACKAGE = "cor_aiworker.storage.migrations"
_MIGRATION_FILE = re.compile(r"(\d{4})_[a-z0-9_]+\.sql")

PRAGMAS = (
    "PRAGMA journal_mode = WAL",  # 读写并发更好，崩溃更安全
    "PRAGMA synchronous = NORMAL",  # WAL 模式下的推荐取值
    "PRAGMA foreign_keys = ON",  # SQLite 默认关闭外键约束，每个连接都要打开
    "PRAGMA busy_timeout = 5000",
)


class DatabaseTooNewError(RuntimeError):
    """数据库来自更新版本的程序，当前版本不认识其结构，拒绝打开以免损坏数据。"""


def now() -> str:
    # 微秒精度：按时间排序时，同一毫秒内的多次写入也能区分先后
    return datetime.now(UTC).isoformat(timespec="microseconds")


def dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def load_migrations() -> list[tuple[int, str]]:
    """读取 migrations 包里的 NNNN_名称.sql，按编号排序；编号必须从 1 开始连续。"""
    found: list[tuple[int, str]] = []
    for entry in importlib.resources.files(MIGRATIONS_PACKAGE).iterdir():
        match = _MIGRATION_FILE.fullmatch(entry.name)
        if match:
            found.append((int(match.group(1)), entry.read_text(encoding="utf-8")))
    found.sort()
    versions = [version for version, _ in found]
    if versions != list(range(1, len(versions) + 1)):
        raise RuntimeError(f"迁移文件编号不连续：{versions}")
    return found


class Database:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn
        self._lock = asyncio.Lock()

    @classmethod
    async def open(cls, path: Path | str) -> Database:
        # isolation_level=None：自动提交模式，事务由 transaction() 显式开启
        conn = await aiosqlite.connect(path, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            for pragma in PRAGMAS:
                await conn.execute(pragma)
            db = cls(conn)
            await db._migrate(load_migrations())
        except BaseException:
            await conn.close()
            raise
        return db

    async def close(self) -> None:
        await self._conn.close()

    async def schema_version(self) -> int:
        row = await self.fetchone("PRAGMA user_version")
        return int(row[0]) if row else 0

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        async with self._lock:
            await self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
            except BaseException:
                await self._conn.execute("ROLLBACK")
                raise
            else:
                await self._conn.execute("COMMIT")

    async def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        async with self._lock:
            return list(await self._conn.execute_fetchall(sql, params))

    async def fetchone(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        rows = await self.fetchall(sql, params)
        return rows[0] if rows else None

    async def _migrate(self, migrations: list[tuple[int, str]]) -> None:
        current = await self.schema_version()
        latest = migrations[-1][0] if migrations else 0
        if current > latest:
            raise DatabaseTooNewError(
                f"数据库结构版本为 {current}，当前程序只支持到 {latest}，请升级程序"
            )
        for version, sql in migrations:
            if version <= current:
                continue
            async with self._lock:
                try:
                    # 每个迁移连同版本号更新在同一个事务里，失败则整体回滚
                    await self._conn.executescript(
                        f"BEGIN IMMEDIATE;\n{sql}\nPRAGMA user_version = {version};\nCOMMIT;"
                    )
                except BaseException:
                    if self._conn.in_transaction:
                        await self._conn.execute("ROLLBACK")
                    raise
