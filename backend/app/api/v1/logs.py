"""Agent 执行日志查询接口。"""
from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, Query

from app.services import log_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/logs", tags=["Logs"])


@router.get(
    "/",
    summary="查询 Agent 执行日志列表",
    description=(
        "返回 Agent 执行记录列表，按时间倒序。\n\n"
        "支持按 `session_id` 筛选，支持分页（`limit` / `offset`）。"
    ),
)
async def list_logs(
    session_id: str | None = Query(None, description="按会话 ID 筛选"),
    limit: int = Query(50, ge=1, le=200, description="每页条数"),
    offset: int = Query(0, ge=0, description="偏移量"),
) -> dict:
    runs = await log_store.get_runs(session_id=session_id, limit=limit, offset=offset)
    total = await log_store.get_total_count(session_id=session_id)

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [_run_to_dict(r) for r in runs],
    }


@router.get(
    "/{run_id}",
    summary="查询单条 Agent 执行日志详情",
)
async def get_log(run_id: str) -> dict:
    run = await log_store.get_run(run_id)
    if run is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"run_id={run_id} not found")
    return _run_to_dict(run, include_rounds=True)


# ── 序列化辅助 ────────────────────────────────────────────────────────────────

def _run_to_dict(run: log_store.AgentRunLog, include_rounds: bool = True) -> dict:
    """将 AgentRunLog dataclass 转为可 JSON 序列化的字典。"""
    d: dict = {
        "run_id":               run.run_id,
        "session_id":           run.session_id,
        "model":                run.model,
        "user_query":           run.user_query,
        "started_at":           run.started_at.isoformat(),
        "finished_at":          run.finished_at.isoformat() if run.finished_at else None,
        "total_duration_ms":    run.total_duration_ms,
        "total_input_tokens":   run.total_input_tokens,
        "total_output_tokens":  run.total_output_tokens,
        "total_rounds":         run.total_rounds,
        "status":               run.status,
        "error_message":        run.error_message,
    }
    if include_rounds:
        d["rounds"] = [_round_to_dict(r) for r in run.rounds]
    return d


def _round_to_dict(r: log_store.AgentRoundLog) -> dict:
    return {
        "round_index":    r.round_index,
        "started_at":     r.started_at.isoformat(),
        "duration_ms":    r.duration_ms,
        "input_tokens":   r.input_tokens,
        "output_tokens":  r.output_tokens,
        "finish_reason":  r.finish_reason,
        "thinking_text":  r.thinking_text,
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
