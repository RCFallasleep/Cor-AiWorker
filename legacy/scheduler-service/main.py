"""Cor-AiWorker Scheduler Service

独立微服务，负责定时任务的调度和执行。

职责：
  1. 启动时从主后端拉取所有 active 任务，恢复 APScheduler 调度
  2. 定时轮询主后端（每 30s），同步新增/取消的任务
  3. 任务到期时执行 action（MVP 只支持 remind 类型）
  4. 执行完成后调用主后端内部接口写入结果 + 触发 WS 推送

环境变量：
  BACKEND_URL            主后端地址，如 http://cor-backend:8000
  SERVICE_TOKEN          与主后端共享的 service token
  POLL_INTERVAL_SECONDS  轮询间隔（默认 30s）
  TZ                     时区（默认 Asia/Shanghai）
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from fastapi import FastAPI

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── 配置 ──────────────────────────────────────────────────────────────────────

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")
SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN", "change-me-scheduler-token")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
TZ = os.environ.get("TZ", "Asia/Shanghai")

_HEADERS = {"X-Service-Token": SERVICE_TOKEN, "Content-Type": "application/json"}

# ── APScheduler ───────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler(timezone=TZ)

# 已注册的任务 ID 集合（避免重复注册）
_registered_task_ids: set[str] = set()


# ── 任务执行 ──────────────────────────────────────────────────────────────────

async def _execute_task(task: dict) -> None:
    """执行单个定时任务（MVP：remind 类型，直接调主后端写结果）。"""
    task_id = task["id"]
    title = task.get("title", "")
    trigger_type = task.get("trigger_type", "once")

    logger.info("scheduler: executing task | id=%s title=%s", task_id, title)

    # MVP 只支持 remind 类型，直接通知主后端写消息
    mark_done = trigger_type == "once"

    # cron 类型：计算下次执行时间
    next_run_at = None
    if trigger_type == "cron" and task.get("cron_expr"):
        try:
            trigger = CronTrigger.from_crontab(task["cron_expr"], timezone=TZ)
            next_fire = trigger.get_next_fire_time(None, datetime.now(timezone.utc))
            next_run_at = next_fire.isoformat() if next_fire else None
        except Exception as e:
            logger.warning("scheduler: failed to compute next_run_at | %s", e)

    payload = {
        "task_id": task_id,
        "status": "success",
        "result": f"定时提醒已发送：{task.get('action_payload', title)}",
        "next_run_at": next_run_at,
        "mark_done": mark_done,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{BACKEND_URL}/v1/schedule/internal/run-result",
                json=payload,
                headers=_HEADERS,
            )
            if resp.status_code == 200:
                logger.info("scheduler: task executed ok | id=%s", task_id)
            else:
                logger.error(
                    "scheduler: run-result failed | id=%s status=%d body=%s",
                    task_id, resp.status_code, resp.text[:200],
                )
    except Exception as e:
        logger.error("scheduler: execute task error | id=%s error=%s", task_id, e)

    # once 类型执行完后从 scheduler 移除
    if mark_done:
        _registered_task_ids.discard(task_id)
        try:
            scheduler.remove_job(task_id)
        except Exception:
            pass


# ── 任务注册 ──────────────────────────────────────────────────────────────────

def _register_task(task: dict) -> bool:
    """将任务注册到 APScheduler，返回是否成功注册。"""
    task_id = task["id"]
    if task_id in _registered_task_ids:
        return False  # 已注册，跳过

    trigger_type = task.get("trigger_type", "once")

    try:
        if trigger_type == "once":
            trigger_at_str = task.get("trigger_at")
            if not trigger_at_str:
                logger.warning("scheduler: once task missing trigger_at | id=%s", task_id)
                return False

            # 解析时间（支持带时区和不带时区的 ISO 格式）
            try:
                if "+" in trigger_at_str or trigger_at_str.endswith("Z"):
                    run_time = datetime.fromisoformat(trigger_at_str.replace("Z", "+00:00"))
                else:
                    # 无时区信息，假设为本地时区
                    from zoneinfo import ZoneInfo
                    run_time = datetime.fromisoformat(trigger_at_str).replace(
                        tzinfo=ZoneInfo(TZ)
                    )
            except ValueError as e:
                logger.warning("scheduler: invalid trigger_at | id=%s error=%s", task_id, e)
                return False

            # 已过期的任务跳过（超过 5 分钟视为过期）
            now = datetime.now(timezone.utc)
            if run_time < now - timedelta(minutes=5):
                logger.info("scheduler: skipping expired task | id=%s trigger_at=%s", task_id, trigger_at_str)
                _registered_task_ids.add(task_id)  # 标记为已处理，避免重复检查
                return False

            trigger = DateTrigger(run_date=run_time)

        elif trigger_type == "cron":
            cron_expr = task.get("cron_expr")
            if not cron_expr:
                logger.warning("scheduler: cron task missing cron_expr | id=%s", task_id)
                return False
            trigger = CronTrigger.from_crontab(cron_expr, timezone=TZ)

        else:
            logger.warning("scheduler: unknown trigger_type | id=%s type=%s", task_id, trigger_type)
            return False

        # 注册到 APScheduler
        scheduler.add_job(
            _execute_task,
            trigger=trigger,
            id=task_id,
            args=[task],
            replace_existing=True,
            misfire_grace_time=300,  # 5 分钟内的错过任务仍执行
        )
        _registered_task_ids.add(task_id)
        logger.info(
            "scheduler: task registered | id=%s type=%s",
            task_id, trigger_type,
        )
        return True

    except Exception as e:
        logger.error("scheduler: register task failed | id=%s error=%s", task_id, e)
        return False


# ── 轮询同步 ──────────────────────────────────────────────────────────────────

async def _sync_tasks() -> None:
    """从主后端拉取 active 任务，注册新任务，移除已取消任务。"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{BACKEND_URL}/v1/schedule/internal/active-tasks",
                headers=_HEADERS,
            )
            if resp.status_code != 200:
                logger.warning("scheduler: sync failed | status=%d", resp.status_code)
                return

            tasks = resp.json()

    except Exception as e:
        logger.warning("scheduler: sync error | %s", e)
        return

    active_ids = {t["id"] for t in tasks}

    # 注册新任务
    new_count = 0
    for task in tasks:
        if task["status"] == "active" and task["id"] not in _registered_task_ids:
            if _register_task(task):
                new_count += 1

    # 移除已不在 active 列表中的任务（被取消/暂停）
    stale_ids = _registered_task_ids - active_ids
    for task_id in stale_ids:
        try:
            scheduler.remove_job(task_id)
            logger.info("scheduler: task removed (no longer active) | id=%s", task_id)
        except Exception:
            pass
        _registered_task_ids.discard(task_id)

    if new_count or stale_ids:
        logger.info(
            "scheduler: sync done | new=%d removed=%d total_active=%d",
            new_count, len(stale_ids), len(_registered_task_ids),
        )


# ── FastAPI 应用（健康检查用）────────────────────────────────────────────────

app = FastAPI(title="Cor-AiWorker Scheduler Service", version="0.1.0")


@app.get("/health")
async def health():
    jobs = scheduler.get_jobs()
    return {
        "status": "ok",
        "registered_tasks": len(_registered_task_ids),
        "scheduler_jobs": len(jobs),
        "next_jobs": [
            {
                "id": j.id,
                "next_run": j.next_run_time.isoformat() if j.next_run_time else None,
            }
            for j in jobs[:10]
        ],
    }


@app.on_event("startup")
async def startup():
    """启动时初始化调度器并同步任务。"""
    logger.info("scheduler-service: starting | backend=%s poll_interval=%ds", BACKEND_URL, POLL_INTERVAL)

    scheduler.start()

    # 等待主后端就绪（最多重试 10 次，每次间隔 3s）
    for attempt in range(10):
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{BACKEND_URL}/health")
                if resp.status_code == 200:
                    logger.info("scheduler-service: backend ready")
                    break
        except Exception:
            pass
        logger.info("scheduler-service: waiting for backend... attempt=%d/10", attempt + 1)
        await asyncio.sleep(3)

    # 初始同步
    await _sync_tasks()

    # 注册周期轮询任务（每 POLL_INTERVAL 秒同步一次）
    scheduler.add_job(
        _sync_tasks,
        "interval",
        seconds=POLL_INTERVAL,
        id="__sync_tasks__",
        replace_existing=True,
    )

    logger.info("scheduler-service: started | registered=%d", len(_registered_task_ids))


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown(wait=False)
    logger.info("scheduler-service: stopped")
