"""Agent 执行日志存储（SQLite 持久化 + 内存缓存）。

架构：
  - 写入：每次 Agent 执行结束时，异步写入 SQLite（aiosqlite）
  - 读取：优先从内存缓存读取（最近 200 条），超出范围时查 SQLite
  - 内存缓存：最多保留最近 200 条，服务重启后从 DB 恢复

数据结构：
  AgentRunLog   - 一次完整的 Agent 执行（对应一条用户消息）
  AgentRoundLog - 一次执行中的单轮循环（一次 LLM 调用）
  ToolCallLog   - 单轮中的一次工具调用

SQLite 表结构：
  agent_runs   - 执行记录主表
  agent_rounds - 轮次记录（JSON 序列化存储）
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import aiosqlite

from app.core.config import settings

logger = logging.getLogger(__name__)

# 内存缓存最大条数
_CACHE_MAX = 200


# ── 数据模型 ──────────────────────────────────────────────────────────────────

@dataclass
class ToolCallLog:
    """单次工具调用记录。"""
    name: str
    args: dict[str, Any]
    result_preview: str          # 结果前 300 字符
    duration_ms: int
    success: bool = True


@dataclass
class AgentRoundLog:
    """Agent 单轮循环记录（一次 LLM 调用）。"""
    round_index: int
    started_at: datetime
    duration_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str = ""
    thinking_text: str = ""
    tool_calls: list[ToolCallLog] = field(default_factory=list)


@dataclass
class AgentRunLog:
    """一次完整的 Agent 执行记录。"""
    run_id: str
    session_id: str
    model: str
    user_query: str
    started_at: datetime
    finished_at: datetime | None = None
    total_duration_ms: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_rounds: int = 0
    status: str = "running"      # running / done / error
    error_message: str = ""
    rounds: list[AgentRoundLog] = field(default_factory=list)


# ── 内存缓存 ──────────────────────────────────────────────────────────────────

_cache: list[AgentRunLog] = []   # 按时间升序，最新在末尾


# ── SQLite 初始化 ─────────────────────────────────────────────────────────────

async def init_db() -> None:
    """创建数据库表（幂等，应用启动时调用一次）。"""
    db_path = settings.log_db_path
    # 确保目录存在
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    async with aiosqlite.connect(db_path) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_runs (
                run_id              TEXT PRIMARY KEY,
                session_id          TEXT NOT NULL,
                model               TEXT NOT NULL,
                user_query          TEXT NOT NULL,
                started_at          TEXT NOT NULL,
                finished_at         TEXT,
                total_duration_ms   INTEGER DEFAULT 0,
                total_input_tokens  INTEGER DEFAULT 0,
                total_output_tokens INTEGER DEFAULT 0,
                total_rounds        INTEGER DEFAULT 0,
                status              TEXT DEFAULT 'running',
                error_message       TEXT DEFAULT '',
                rounds_json         TEXT DEFAULT '[]'
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_runs_session ON agent_runs(session_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_runs_started ON agent_runs(started_at DESC)"
        )
        await db.commit()

    logger.info("log_store: SQLite initialized | path=%s", db_path)

    # 启动时从 DB 恢复最近 _CACHE_MAX 条到内存缓存
    await _restore_cache()


async def _restore_cache() -> None:
    """从 SQLite 恢复最近记录到内存缓存。"""
    global _cache
    try:
        rows = await _query_db(limit=_CACHE_MAX, offset=0, session_id=None)
        # query_db 返回倒序，缓存需要升序
        _cache = list(reversed(rows))
        logger.info("log_store: cache restored | count=%d", len(_cache))
    except Exception as e:
        logger.warning("log_store: cache restore failed | %s", e)


# ── 序列化辅助 ────────────────────────────────────────────────────────────────

def _rounds_to_json(rounds: list[AgentRoundLog]) -> str:
    return json.dumps([
        {
            "round_index":   r.round_index,
            "started_at":    r.started_at.isoformat(),
            "duration_ms":   r.duration_ms,
            "input_tokens":  r.input_tokens,
            "output_tokens": r.output_tokens,
            "finish_reason": r.finish_reason,
            "thinking_text": r.thinking_text,
            "tool_calls": [
                {
                    "name":           tc.name,
                    "args":           tc.args,
                    "result_preview": tc.result_preview,
                    "duration_ms":    tc.duration_ms,
                    "success":        tc.success,
                }
                for tc in r.tool_calls
            ],
        }
        for r in rounds
    ], ensure_ascii=False)


def _rounds_from_json(raw: str) -> list[AgentRoundLog]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    rounds = []
    for d in data:
        tool_calls = [
            ToolCallLog(
                name=tc["name"],
                args=tc.get("args", {}),
                result_preview=tc.get("result_preview", ""),
                duration_ms=tc.get("duration_ms", 0),
                success=tc.get("success", True),
            )
            for tc in d.get("tool_calls", [])
        ]
        rounds.append(AgentRoundLog(
            round_index=d["round_index"],
            started_at=datetime.fromisoformat(d["started_at"]),
            duration_ms=d.get("duration_ms", 0),
            input_tokens=d.get("input_tokens", 0),
            output_tokens=d.get("output_tokens", 0),
            finish_reason=d.get("finish_reason", ""),
            thinking_text=d.get("thinking_text", ""),
            tool_calls=tool_calls,
        ))
    return rounds


def _row_to_run(row: aiosqlite.Row, include_rounds: bool = True) -> AgentRunLog:
    return AgentRunLog(
        run_id=row[0],
        session_id=row[1],
        model=row[2],
        user_query=row[3],
        started_at=datetime.fromisoformat(row[4]),
        finished_at=datetime.fromisoformat(row[5]) if row[5] else None,
        total_duration_ms=row[6],
        total_input_tokens=row[7],
        total_output_tokens=row[8],
        total_rounds=row[9],
        status=row[10],
        error_message=row[11] or "",
        rounds=_rounds_from_json(row[12]) if include_rounds else [],
    )


# ── SQLite 读写 ───────────────────────────────────────────────────────────────

async def _upsert_run(run: AgentRunLog) -> None:
    """将 AgentRunLog 写入（或更新）SQLite。"""
    db_path = settings.log_db_path
    try:
        async with aiosqlite.connect(db_path) as db:
            await db.execute("""
                INSERT INTO agent_runs
                    (run_id, session_id, model, user_query, started_at, finished_at,
                     total_duration_ms, total_input_tokens, total_output_tokens,
                     total_rounds, status, error_message, rounds_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(run_id) DO UPDATE SET
                    finished_at         = excluded.finished_at,
                    total_duration_ms   = excluded.total_duration_ms,
                    total_input_tokens  = excluded.total_input_tokens,
                    total_output_tokens = excluded.total_output_tokens,
                    total_rounds        = excluded.total_rounds,
                    status              = excluded.status,
                    error_message       = excluded.error_message,
                    rounds_json         = excluded.rounds_json
            """, (
                run.run_id,
                run.session_id,
                run.model,
                run.user_query,
                run.started_at.isoformat(),
                run.finished_at.isoformat() if run.finished_at else None,
                run.total_duration_ms,
                run.total_input_tokens,
                run.total_output_tokens,
                run.total_rounds,
                run.status,
                run.error_message,
                _rounds_to_json(run.rounds),
            ))
            await db.commit()
    except Exception as e:
        logger.error("log_store: upsert failed | run_id=%s err=%s", run.run_id, e)


async def _query_db(
    session_id: str | None,
    limit: int,
    offset: int,
    include_rounds: bool = False,
) -> list[AgentRunLog]:
    """从 SQLite 查询记录列表（倒序）。"""
    db_path = settings.log_db_path
    if not os.path.exists(db_path):
        return []
    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            if session_id:
                sql = """
                    SELECT run_id, session_id, model, user_query, started_at, finished_at,
                           total_duration_ms, total_input_tokens, total_output_tokens,
                           total_rounds, status, error_message, rounds_json
                    FROM agent_runs
                    WHERE session_id = ?
                    ORDER BY started_at DESC
                    LIMIT ? OFFSET ?
                """
                cursor = await db.execute(sql, (session_id, limit, offset))
            else:
                sql = """
                    SELECT run_id, session_id, model, user_query, started_at, finished_at,
                           total_duration_ms, total_input_tokens, total_output_tokens,
                           total_rounds, status, error_message, rounds_json
                    FROM agent_runs
                    ORDER BY started_at DESC
                    LIMIT ? OFFSET ?
                """
                cursor = await db.execute(sql, (limit, offset))
            rows = await cursor.fetchall()
            return [_row_to_run(row, include_rounds=include_rounds) for row in rows]
    except Exception as e:
        logger.error("log_store: query failed | %s", e)
        return []


async def _count_db(session_id: str | None) -> int:
    """从 SQLite 查询记录总数。"""
    db_path = settings.log_db_path
    if not os.path.exists(db_path):
        return 0
    try:
        async with aiosqlite.connect(db_path) as db:
            if session_id:
                cursor = await db.execute(
                    "SELECT COUNT(*) FROM agent_runs WHERE session_id = ?", (session_id,)
                )
            else:
                cursor = await db.execute("SELECT COUNT(*) FROM agent_runs")
            row = await cursor.fetchone()
            return row[0] if row else 0
    except Exception as e:
        logger.error("log_store: count failed | %s", e)
        return 0


# ── 公开 API ──────────────────────────────────────────────────────────────────

def create_run(session_id: str, model: str, user_query: str) -> AgentRunLog:
    """创建一条新的执行记录，加入内存缓存（执行结束后再持久化）。"""
    run = AgentRunLog(
        run_id=str(uuid.uuid4()),
        session_id=session_id,
        model=model,
        user_query=user_query,
        started_at=datetime.now(),
    )
    _cache.append(run)
    # 超出上限时删除最旧的
    if len(_cache) > _CACHE_MAX:
        _cache.pop(0)
    return run


async def finish_run(run: AgentRunLog) -> None:
    """执行结束时调用，将记录持久化到 SQLite。"""
    await _upsert_run(run)


async def get_runs(
    session_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AgentRunLog]:
    """查询执行记录列表（倒序）。优先从 SQLite 查询以保证完整性。"""
    return await _query_db(session_id=session_id, limit=limit, offset=offset, include_rounds=False)


async def get_run(run_id: str) -> AgentRunLog | None:
    """按 run_id 查询单条记录（含完整 rounds）。先查内存缓存，再查 SQLite。"""
    # 先查内存缓存
    for r in reversed(_cache):
        if r.run_id == run_id:
            return r

    # 缓存未命中，查 SQLite
    db_path = settings.log_db_path
    if not os.path.exists(db_path):
        return None
    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                """SELECT run_id, session_id, model, user_query, started_at, finished_at,
                          total_duration_ms, total_input_tokens, total_output_tokens,
                          total_rounds, status, error_message, rounds_json
                   FROM agent_runs WHERE run_id = ?""",
                (run_id,),
            )
            row = await cursor.fetchone()
            return _row_to_run(row, include_rounds=True) if row else None
    except Exception as e:
        logger.error("log_store: get_run failed | run_id=%s err=%s", run_id, e)
        return None


async def get_total_count(session_id: str | None = None) -> int:
    """返回记录总数（从 SQLite 查询）。"""
    return await _count_db(session_id)
