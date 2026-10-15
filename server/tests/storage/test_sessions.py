from __future__ import annotations

import asyncio
from typing import Any

from cor_aiworker.storage.db import Database
from cor_aiworker.storage.runs import RunStore
from cor_aiworker.storage.sessions import SessionStore


async def test_create_get_and_list(db: Database) -> None:
    store = SessionStore(db)
    first = await store.create(provider="anthropic", model="claude-opus-5-5", title="第一个")
    second = await store.create(provider="deepseek", model="deepseek-v4-pro")

    assert await store.get(first.id) == first
    assert await store.get("missing") is None
    await store.append_messages(first.id, [{"role": "user", "content": "hi"}])
    # 有新消息的会话排在前面
    assert [s.id for s in await store.recent()] == [first.id, second.id]


async def test_native_messages_round_trip(db: Database) -> None:
    store = SessionStore(db)
    session = await store.create(provider="anthropic", model="m")
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "现在东京几点？"},
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "", "signature": "sig=="},
                {"type": "tool_use", "id": "t1", "name": "get_current_time", "input": {}},
            ],
        },
    ]
    await store.append_messages(session.id, messages[:1])
    await store.append_messages(session.id, messages[1:])
    assert await store.load_messages(session.id) == messages


async def test_concurrent_appends_keep_order_unique(db: Database) -> None:
    store = SessionStore(db)
    session = await store.create(provider="p", model="m")
    await asyncio.gather(*(store.append_messages(session.id, [{"i": i}]) for i in range(20)))
    rows = await db.fetchall("SELECT seq FROM messages WHERE session_id = ?", (session.id,))
    assert sorted(r["seq"] for r in rows) == list(range(1, 21))


async def test_rename_and_delete_cascades(db: Database) -> None:
    sessions, runs = SessionStore(db), RunStore(db)
    session = await sessions.create(provider="p", model="m")
    run = await runs.start(session.id, "问题")
    await sessions.append_messages(session.id, [{"role": "user"}], run_id=run.id)
    await runs.append_events(run.id, [{"type": "run_started"}])

    assert await sessions.rename(session.id, "新标题")
    renamed = await sessions.get(session.id)
    assert renamed is not None
    assert renamed.title == "新标题"
    assert await sessions.delete(session.id)
    assert not await sessions.delete(session.id)
    assert await db.fetchall("SELECT * FROM messages") == []
    assert await db.fetchall("SELECT * FROM runs") == []
    assert await db.fetchall("SELECT * FROM run_events") == []
