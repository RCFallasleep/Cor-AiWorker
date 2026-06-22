"""定时任务 REST API。

提供工作台所需的查询、暂停/恢复、删除接口。
任务创建通过 Agent 工具（create_scheduled_task）完成，不在此处提供。

端点：
  GET    /v1/schedule/tasks                  查询当前用户所有任务
  GET    /v1/schedule/tasks/{task_id}/runs   查询任务执行记录
  PATCH  /v1/schedule/tasks/{task_id}        暂停 / 恢复任务
  DELETE /v1/schedule/tasks/{task_id}        取消任务

内部端点（供 scheduler-service 调用，需 service token）：
  POST   /v1/schedule/internal/run-result    写入执行结果 + 触发 WS 推送
  GET    /v1/schedule/internal/active-tasks  拉取所有 active 任务（重启恢复用）
"""
from __future__ import annotations

import logging
import uuid
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import get_current_user
from app.core.config import settings
from app.services.corwork_db import _DB_PATH, now_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedule", tags=["Schedule"])

CurrentUser = Annotated[dict, Depends(get_current_user)]


# ══════════════════════════════════════════════════════════════════════════════
# 工作台接口（需要用户认证）
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/tasks", summary="查询当前用户的定时任务列表")
async def list_tasks(
    current_user: CurrentUser,
    status: str | None = Query(default=None, description="筛选状态：active/paused/done/cancelled，不传返回全部"),
):
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status:
            cursor = await db.execute(
                """SELECT t.*,
                          (SELECT COUNT(*) FROM task_runs r WHERE r.task_id=t.id) as run_count,
                          (SELECT r.status FROM task_runs r WHERE r.task_id=t.id ORDER BY r.started_at DESC LIMIT 1) as last_run_status,
                          (SELECT r.started_at FROM task_runs r WHERE r.task_id=t.id ORDER BY r.started_at DESC LIMIT 1) as last_run_at
                   FROM scheduled_tasks t
                   WHERE t.user_id=? AND t.status=?
                   ORDER BY t.created_at DESC""",
                (uid, status),
            )
        else:
            cursor = await db.execute(
                """SELECT t.*,
                          (SELECT COUNT(*) FROM task_runs r WHERE r.task_id=t.id) as run_count,
                          (SELECT r.status FROM task_runs r WHERE r.task_id=t.id ORDER BY r.started_at DESC LIMIT 1) as last_run_status,
                          (SELECT r.started_at FROM task_runs r WHERE r.task_id=t.id ORDER BY r.started_at DESC LIMIT 1) as last_run_at
                   FROM scheduled_tasks t
                   WHERE t.user_id=?
                   ORDER BY t.created_at DESC""",
                (uid,),
            )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/tasks/{task_id}/runs", summary="查询任务执行记录")
async def list_task_runs(
    task_id: str,
    current_user: CurrentUser,
    limit: int = Query(default=20, le=100),
):
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # 验证任务归属
        cur = await db.execute(
            "SELECT id FROM scheduled_tasks WHERE id=? AND user_id=?", (task_id, uid)
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="任务不存在")

        cursor = await db.execute(
            """SELECT * FROM task_runs WHERE task_id=?
               ORDER BY started_at DESC LIMIT ?""",
            (task_id, limit),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


class TaskPatchBody(BaseModel):
    status: str  # "active" | "paused"


@router.patch("/tasks/{task_id}", summary="暂停或恢复任务")
async def patch_task(task_id: str, body: TaskPatchBody, current_user: CurrentUser):
    if body.status not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="status 只能是 active 或 paused")

    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "SELECT id, status FROM scheduled_tasks WHERE id=? AND user_id=?", (task_id, uid)
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="任务不存在")
        if row[1] in ("done", "cancelled"):
            raise HTTPException(status_code=400, detail="已完成或已取消的任务不能修改状态")

        await db.execute(
            "UPDATE scheduled_tasks SET status=? WHERE id=?", (body.status, task_id)
        )
        await db.commit()

    return {"ok": True, "status": body.status}


@router.delete("/tasks/{task_id}", summary="取消任务")
async def cancel_task(task_id: str, current_user: CurrentUser):
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "SELECT id FROM scheduled_tasks WHERE id=? AND user_id=?", (task_id, uid)
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="任务不存在")

        await db.execute(
            "UPDATE scheduled_tasks SET status='cancelled' WHERE id=?", (task_id,)
        )
        await db.commit()

    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# 内部接口（供 scheduler-service 调用）
# ══════════════════════════════════════════════════════════════════════════════

def _verify_service_token(x_service_token: str | None = Header(default=None)):
    """验证 scheduler-service 的内部 service token。"""
    expected = settings.scheduler_service_token
    if not expected or x_service_token != expected:
        raise HTTPException(status_code=403, detail="无效的 service token")


class RunResultBody(BaseModel):
    task_id: str
    status: str          # "success" | "failed"
    result: str          # 执行结果或错误信息
    # 任务执行后更新 next_run_at（cron 类型）或 status=done（once 类型）
    next_run_at: str | None = None
    mark_done: bool = False


@router.post("/internal/run-result", summary="[内部] 写入执行结果", include_in_schema=False)
async def internal_run_result(
    body: RunResultBody,
    _: None = Depends(_verify_service_token),
):
    """scheduler-service 执行完任务后调用，写入 task_runs 并推送 WS 通知。"""
    run_id = str(uuid.uuid4())
    ts = now_iso()

    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # 查询任务信息（获取 user_id / target_user_id / title）
        cur = await db.execute(
            "SELECT * FROM scheduled_tasks WHERE id=?", (body.task_id,)
        )
        task = await cur.fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")
        task = dict(task)

        # 写入执行记录
        await db.execute(
            """INSERT INTO task_runs (id, task_id, started_at, finished_at, status, result)
               VALUES (?,?,?,?,?,?)""",
            (run_id, body.task_id, ts, ts, body.status, body.result),
        )

        # 更新任务状态
        if body.mark_done:
            await db.execute(
                "UPDATE scheduled_tasks SET status='done' WHERE id=?", (body.task_id,)
            )
        elif body.next_run_at:
            await db.execute(
                "UPDATE scheduled_tasks SET next_run_at=? WHERE id=?",
                (body.next_run_at, body.task_id),
            )

        # 写入提醒消息到 messages 表（remind 类型）
        if task["action_type"] == "remind" and body.status == "success":
            msg_id = str(uuid.uuid4())
            user_id = task["user_id"]
            target_user_id = task["target_user_id"]
            conv_id = "_".join(sorted([user_id, target_user_id]))
            remind_content = task["action_payload"] or task["title"]

            await db.execute(
                """INSERT INTO messages
                   (id, conversation_id, sender_id, receiver_id, content, msg_type, is_agent_reply, created_at)
                   VALUES (?,?,?,?,?,?,1,?)""",
                (msg_id, conv_id, target_user_id, user_id,
                 f"⏰ **定时提醒**：{remind_content}", "scheduled_remind", ts),
            )

            await db.commit()

            # WS 推送给用户
            try:
                from app.api.v1.collab import _ws_manager
                msg_payload = {
                    "id": msg_id,
                    "conversation_id": conv_id,
                    "sender_id": target_user_id,
                    "receiver_id": user_id,
                    "content": f"⏰ **定时提醒**：{remind_content}",
                    "msg_type": "scheduled_remind",
                    "is_agent_reply": 1,
                    "created_at": ts,
                }
                await _ws_manager.broadcast_to_user(user_id, {"type": "new_message", "data": msg_payload})
                logger.info("schedule: remind sent | task=%s user=%s", body.task_id, user_id)
            except Exception as e:
                logger.warning("schedule: ws push failed (non-fatal) | %s", e)
        else:
            await db.commit()

    return {"ok": True, "run_id": run_id}


@router.get("/internal/active-tasks", summary="[内部] 拉取所有 active 任务", include_in_schema=False)
async def internal_active_tasks(
    _: None = Depends(_verify_service_token),
):
    """scheduler-service 启动时调用，拉取所有 active 任务用于恢复调度。"""
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM scheduled_tasks
               WHERE status='active'
               ORDER BY next_run_at ASC""",
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]
