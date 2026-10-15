from __future__ import annotations

from cor_aiworker.storage.db import Database
from cor_aiworker.storage.runs import RunStore, RunTotals
from cor_aiworker.storage.sessions import SessionStore


async def new_run(db: Database) -> tuple[RunStore, str, str]:
    session = await SessionStore(db).create(provider="p", model="m")
    runs = RunStore(db)
    run = await runs.start(session.id, "问题")
    return runs, session.id, run.id


async def test_run_lifecycle(db: Database) -> None:
    runs, session_id, run_id = await new_run(db)
    started = await runs.get(run_id)
    assert started is not None
    assert (started.status, started.finished_at) == ("running", None)

    await runs.finish(run_id, RunTotals("end", 2, 1, 1000, 50, 800, 100))
    finished = await runs.get(run_id)
    assert finished is not None
    assert finished.status == "finished"
    assert (finished.turns, finished.input_tokens, finished.cache_read_tokens) == (2, 1000, 800)
    assert finished.finished_at is not None
    assert [r.id for r in await runs.for_session(session_id)] == [run_id]


async def test_fail_and_cancel(db: Database) -> None:
    runs, _, run_id = await new_run(db)
    await runs.fail(run_id, error="超时", cancelled=True)
    record = await runs.get(run_id)
    assert record is not None
    assert (record.status, record.error) == ("cancelled", "超时")


async def test_recover_interrupted_runs(db: Database) -> None:
    runs, _, running = await new_run(db)
    _, _, done = await new_run(db)
    await runs.finish(done, RunTotals("end", 1, 0, 1, 1, 0, 0))

    assert await runs.recover_interrupted() == 1
    interrupted, finished = await runs.get(running), await runs.get(done)
    assert interrupted is not None and interrupted.status == "cancelled"
    assert finished is not None and finished.status == "finished"


async def test_events_are_sequenced_and_resumable(db: Database) -> None:
    runs, _, run_id = await new_run(db)
    first = await runs.append_events(run_id, [{"type": "run_started"}, {"type": "text_delta"}])
    second = await runs.append_events(run_id, [{"type": "run_finished", "turns": 1}])
    assert (first, second) == ([1, 2], [3])

    resumed = await runs.events(run_id, after_seq=2)
    assert [(e.seq, e.type) for e in resumed] == [(3, "run_finished")]
    assert resumed[0].payload == {"type": "run_finished", "turns": 1}
