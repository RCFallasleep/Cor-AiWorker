"""scheduler — 定时任务 Agent 工具。

提供三个工具供 LLM 调用：
  - create_scheduled_task  创建定时任务（一次性 / 周期）
  - list_scheduled_tasks   查询当前用户的任务列表
  - cancel_scheduled_task  取消指定任务

注册方式：模块被 import 时自动注册到全局 tool_registry。

设计说明：
  - 工具写入 corwork.db 的 scheduled_tasks 表
  - scheduler-service 独立容器定时轮询该表，到期后执行 action
  - user_id / target_user_id 由 agent_service 在执行前注入（LLM 不传敏感字段）
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import aiosqlite

from app.services.corwork_db import _DB_PATH, now_iso
from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)


# ── 工具处理函数 ──────────────────────────────────────────────────────────────

async def _handle_create_scheduled_task(
    title: str,
    trigger_type: str,
    action_payload: str,
    trigger_at: str | None = None,
    cron_expr: str | None = None,
    # 以下字段由 agent_service 注入，LLM 不传
    user_id: str = "",
    target_user_id: str = "",
) -> str:
    """创建定时任务，写入 scheduled_tasks 表。"""
    if not user_id or not target_user_id:
        return "[错误] 缺少用户信息，无法创建任务（系统内部错误）"

    if trigger_type not in ("once", "cron"):
        return "[错误] trigger_type 必须是 'once'（一次性）或 'cron'（周期）"

    if trigger_type == "once" and not trigger_at:
        return "[错误] 一次性任务必须提供 trigger_at（ISO 时间字符串，如 2026-06-22T09:00:00）"

    if trigger_type == "cron" and not cron_expr:
        return "[错误] 周期任务必须提供 cron_expr（cron 表达式，如 '0 9 * * 1' = 每周一 9:00）"

    task_id = str(uuid.uuid4())
    ts = now_iso()

    # next_run_at：once 类型直接用 trigger_at，cron 类型暂存 cron_expr（scheduler-service 计算）
    next_run_at = trigger_at if trigger_type == "once" else None

    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute(
                """INSERT INTO scheduled_tasks
                   (id, user_id, target_user_id, title, trigger_type, trigger_at, cron_expr,
                    action_type, action_payload, status, created_at, next_run_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    task_id, user_id, target_user_id, title,
                    trigger_type, trigger_at, cron_expr,
                    "remind", action_payload,
                    "active", ts, next_run_at,
                ),
            )
            await db.commit()

        logger.info(
            "scheduler: task created | id=%s user=%s type=%s",
            task_id, user_id, trigger_type,
        )
    except Exception as e:
        logger.error("scheduler: create task failed | %s", e)
        return f"[错误] 任务创建失败：{e}"

    # 构建友好的确认消息
    if trigger_type == "once":
        time_desc = f"将在 {trigger_at} 提醒你"
    else:
        time_desc = f"将按照 cron 表达式「{cron_expr}」周期执行"

    return (
        f"✅ 定时任务已创建！\n\n"
        f"**任务**：{title}\n"
        f"**类型**：{'一次性' if trigger_type == 'once' else '周期'}\n"
        f"**时间**：{time_desc}\n"
        f"**提醒内容**：{action_payload}\n"
        f"**任务 ID**：{task_id}\n\n"
        f"到时间后，你的 Agent 助理会在协作消息中提醒你。"
    )


async def _handle_list_scheduled_tasks(
    user_id: str = "",
    status: str = "active",
) -> str:
    """查询当前用户的定时任务列表。"""
    if not user_id:
        return "[错误] 缺少用户信息（系统内部错误）"

    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            if status == "all":
                cursor = await db.execute(
                    """SELECT id, title, trigger_type, trigger_at, cron_expr,
                              action_payload, status, created_at, next_run_at
                       FROM scheduled_tasks WHERE user_id=?
                       ORDER BY created_at DESC LIMIT 20""",
                    (user_id,),
                )
            else:
                cursor = await db.execute(
                    """SELECT id, title, trigger_type, trigger_at, cron_expr,
                              action_payload, status, created_at, next_run_at
                       FROM scheduled_tasks WHERE user_id=? AND status=?
                       ORDER BY next_run_at ASC LIMIT 20""",
                    (user_id, status),
                )
            rows = await cursor.fetchall()
    except Exception as e:
        return f"[错误] 查询失败：{e}"

    if not rows:
        return "当前没有定时任务。"

    lines = [f"共 {len(rows)} 个任务：\n"]
    for r in rows:
        r = dict(r)
        type_label = "一次性" if r["trigger_type"] == "once" else "周期"
        time_info = r.get("trigger_at") or r.get("cron_expr") or "-"
        lines.append(
            f"- **{r['title']}** [{type_label}] | 时间：{time_info} | "
            f"状态：{r['status']} | ID：{r['id'][:8]}..."
        )

    return "\n".join(lines)


async def _handle_cancel_scheduled_task(
    task_id: str,
    user_id: str = "",
) -> str:
    """取消指定定时任务（只能取消自己的任务）。"""
    if not user_id:
        return "[错误] 缺少用户信息（系统内部错误）"

    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            # 验证任务归属
            cur = await db.execute(
                "SELECT id, title, status FROM scheduled_tasks WHERE id=? AND user_id=?",
                (task_id, user_id),
            )
            row = await cur.fetchone()
            if not row:
                return f"[错误] 任务不存在或无权操作（ID：{task_id}）"

            title = row[1]
            if row[2] == "cancelled":
                return f"任务「{title}」已经是取消状态。"

            await db.execute(
                "UPDATE scheduled_tasks SET status='cancelled' WHERE id=?",
                (task_id,),
            )
            await db.commit()

        logger.info("scheduler: task cancelled | id=%s user=%s", task_id, user_id)
        return f"✅ 已取消任务「{title}」（ID：{task_id[:8]}...）"
    except Exception as e:
        return f"[错误] 取消失败：{e}"


# ── 注册到全局 tool_registry ──────────────────────────────────────────────────

tool_registry.register(
    ToolDefinition(
        name="create_scheduled_task",
        description=(
            "创建定时任务。当用户说「提醒我...」「X 点帮我...」「每周...」等时调用此工具。\n"
            "支持一次性任务（trigger_type=once）和周期任务（trigger_type=cron）。\n"
            "任务到期后，用户的 Agent 助理会在协作消息中发送提醒。\n"
            "注意：trigger_at 必须是 ISO 8601 格式（如 2026-06-22T09:00:00+08:00），"
            "cron_expr 使用标准 5 段 cron 格式（分 时 日 月 周）。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "任务标题，简短描述任务内容，如「开周会提醒」",
                },
                "trigger_type": {
                    "type": "string",
                    "enum": ["once", "cron"],
                    "description": "触发类型：once=一次性，cron=周期",
                },
                "trigger_at": {
                    "type": "string",
                    "description": "触发时间（once 类型必填），ISO 8601 格式，如 2026-06-22T09:00:00+08:00",
                },
                "cron_expr": {
                    "type": "string",
                    "description": "cron 表达式（cron 类型必填），如 '0 9 * * 1'（每周一 9:00）",
                },
                "action_payload": {
                    "type": "string",
                    "description": "提醒内容文案，到期后作为消息发送给用户，如「该开周会了！」",
                },
            },
            "required": ["title", "trigger_type", "action_payload"],
        },
        handler=_handle_create_scheduled_task,
    )
)

tool_registry.register(
    ToolDefinition(
        name="list_scheduled_tasks",
        description=(
            "查询当前用户的定时任务列表。"
            "当用户问「我有哪些提醒」「我的定时任务」时调用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["active", "done", "cancelled", "all"],
                    "description": "筛选状态：active=进行中（默认），done=已完成，cancelled=已取消，all=全部",
                },
            },
            "required": [],
        },
        handler=_handle_list_scheduled_tasks,
    )
)

tool_registry.register(
    ToolDefinition(
        name="cancel_scheduled_task",
        description=(
            "取消指定定时任务。当用户说「取消那个提醒」「不用提醒我了」时调用。"
            "需要先用 list_scheduled_tasks 获取任务 ID。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "要取消的任务 ID（完整 UUID）",
                },
            },
            "required": ["task_id"],
        },
        handler=_handle_cancel_scheduled_task,
    )
)

logger.info("tool registered | name=create_scheduled_task,list_scheduled_tasks,cancel_scheduled_task")
