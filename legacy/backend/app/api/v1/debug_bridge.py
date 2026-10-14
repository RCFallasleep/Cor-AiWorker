"""
debug_bridge.py — 断点调试桥接 API

接收 debuggerPlugin（Android Studio 插件）推送的断点快照，
缓存供 Agent MCP 工具读取，并提供断点推荐的存取接口。

新版插件工作方式（零配置）：
  - 插件启动后自动向 POST http://localhost:8000/v1/debug/snapshot 推送快照
  - 插件轮询 GET http://localhost:8000/v1/debug/recommend/poll 拉取断点推荐
  - Agent 调用 set_breakpoint 工具时，后端将推荐写入队列，插件下次轮询时取走
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/debug", tags=["Debug Bridge"])

# ── 内存缓存 ──────────────────────────────────────────────────────────────────
_snapshots: deque[dict[str, Any]] = deque(maxlen=20)
_snapshot_event = asyncio.Event()   # 新快照到来时 set，供 wait_for_breakpoint 使用

# 断点推荐队列：Agent 写入，插件轮询取走（最多保留 50 条）
_recommend_queue: deque[dict[str, Any]] = deque(maxlen=50)


# ── Schema ────────────────────────────────────────────────────────────────────

class RecommendRequest(BaseModel):
    """Agent 调用 set_breakpoint 时写入推荐队列。"""
    file: str
    line: int
    reason: str = ""


# ── 接口实现 ──────────────────────────────────────────────────────────────────

@router.post("/snapshot")
async def receive_snapshot(request: Request):
    """
    接收 debuggerPlugin 推送的断点快照（断点命中时自动调用）。
    插件硬编码推送到 http://localhost:8000/v1/debug/snapshot，零配置。
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体必须是合法 JSON")

    snapshot = {**body, "_received_at": time.time()}
    _snapshots.append(snapshot)
    _snapshot_event.set()
    _snapshot_event.clear()

    logger.info(
        "debug snapshot received | file=%s line=%s",
        _extract_file(body),
        _extract_line(body),
    )
    return {"status": "ok"}


@router.get("/snapshot/latest")
async def get_latest_snapshot():
    """返回最新的断点快照，供前端轮询展示。"""
    if not _snapshots:
        return {"has_snapshot": False, "snapshot": None}
    return {"has_snapshot": True, "snapshot": _snapshots[-1]}


@router.get("/snapshot/list")
async def list_snapshots(limit: int = 10):
    """返回最近 N 条断点快照列表。"""
    items = list(_snapshots)[-limit:]
    return {"count": len(items), "snapshots": items}


@router.post("/recommend")
async def enqueue_recommend(body: RecommendRequest):
    """
    Agent 调用 set_breakpoint 时，将断点推荐写入队列。
    插件通过 GET /recommend/poll 轮询取走并在 AS 中打断点。
    """
    item = {
        "file": body.file,
        "line": body.line,
        "reason": body.reason,
        "queued_at": time.time(),
    }
    _recommend_queue.append(item)
    logger.info("recommend enqueued | file=%s line=%d", body.file, body.line)
    return {"status": "ok", "message": f"断点推荐已入队：{body.file}:{body.line}"}


@router.get("/recommend/poll")
async def poll_recommend(timeout: int = 20):
    """
    插件长轮询接口：有推荐时立即返回，无推荐时最多等待 timeout 秒。
    插件每次取走后队列清空该条，保证每条推荐只被消费一次。
    """
    timeout = min(timeout, 30)  # 最多等 30 秒
    deadline = time.time() + timeout

    while True:
        if _recommend_queue:
            item = _recommend_queue.popleft()
            logger.info("recommend polled | file=%s line=%d", item["file"], item["line"])
            return {
                "has_recommend": True,
                "recommendations": [item],
            }
        remaining = deadline - time.time()
        if remaining <= 0:
            return {"has_recommend": False, "recommendations": []}
        await asyncio.sleep(min(1.0, remaining))


# ── 内部工具函数 ──────────────────────────────────────────────────────────────

def _extract_file(body: dict) -> str:
    if "snapshot" in body:
        return body["snapshot"].get("file", "unknown")
    if "breakpoints" in body and body["breakpoints"]:
        loc = body["breakpoints"][0].get("location", "")
        return loc.split(" · ")[0] if " · " in loc else loc
    return "unknown"


def _extract_line(body: dict) -> int:
    if "snapshot" in body:
        return body["snapshot"].get("line", -1)
    if "breakpoints" in body and body["breakpoints"]:
        loc = body["breakpoints"][0].get("location", "")
        parts = loc.split(" · ")
        if len(parts) >= 3:
            return int(parts[2].lstrip("L")) if parts[2].startswith("L") else -1
    return -1


def get_snapshots_deque() -> deque:
    """供 MCP 工具直接访问快照缓存。"""
    return _snapshots


def get_snapshot_event() -> asyncio.Event:
    """供 wait_for_breakpoint 工具等待新快照事件。"""
    return _snapshot_event
