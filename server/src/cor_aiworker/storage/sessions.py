"""会话与会话历史。"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from typing import Any

from .db import Database, dump_json, now


@dataclass(frozen=True)
class SessionRecord:
    id: str
    title: str
    provider: str
    model: str
    created_at: str
    updated_at: str


def _session(row: sqlite3.Row) -> SessionRecord:
    return SessionRecord(
        id=row["id"],
        title=row["title"],
        provider=row["provider"],
        model=row["model"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class SessionStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def create(self, *, provider: str, model: str, title: str = "") -> SessionRecord:
        timestamp = now()
        record = SessionRecord(uuid.uuid4().hex, title, provider, model, timestamp, timestamp)
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO sessions (id, title, provider, model, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    record.id,
                    record.title,
                    record.provider,
                    record.model,
                    record.created_at,
                    record.updated_at,
                ),
            )
        return record

    async def get(self, session_id: str) -> SessionRecord | None:
        row = await self._db.fetchone("SELECT * FROM sessions WHERE id = ?", (session_id,))
        return _session(row) if row else None

    async def recent(self, limit: int = 50) -> list[SessionRecord]:
        rows = await self._db.fetchall(
            "SELECT * FROM sessions ORDER BY updated_at DESC, id LIMIT ?", (limit,)
        )
        return [_session(r) for r in rows]

    async def rename(self, session_id: str, title: str) -> bool:
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title, now(), session_id),
            )
            return cursor.rowcount > 0

    async def delete(self, session_id: str) -> bool:
        """删除会话，连同历史、运行与运行日志（外键级联）。"""
        async with self._db.transaction() as conn:
            cursor = await conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            return cursor.rowcount > 0

    async def append_messages(
        self, session_id: str, messages: list[dict[str, Any]], *, run_id: str | None = None
    ) -> None:
        if not messages:
            return
        timestamp = now()
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "SELECT COALESCE(MAX(seq), 0) FROM messages WHERE session_id = ?", (session_id,)
            )
            row = await cursor.fetchone()
            start = int(row[0]) + 1 if row else 1
            await conn.executemany(
                "INSERT INTO messages (session_id, seq, run_id, content, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                [
                    (session_id, start + i, run_id, dump_json(message), timestamp)
                    for i, message in enumerate(messages)
                ],
            )
            await conn.execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?", (timestamp, session_id)
            )

    async def load_messages(self, session_id: str) -> list[dict[str, Any]]:
        rows = await self._db.fetchall(
            "SELECT content FROM messages WHERE session_id = ? ORDER BY seq", (session_id,)
        )
        return [json.loads(r["content"]) for r in rows]
