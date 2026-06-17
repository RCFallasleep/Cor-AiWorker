"""
debug_bridge.py — 断点调试桥接 API

接收 debuggerPlugin（Android Studio 插件）推送的断点快照，
缓存供 Agent MCP 工具读取，并提供向插件转发断点推荐的接口。

端口约定（来自 debuggerPlugin）：
  - 插件向后端 POST /v1/debug/snapshot（本文件）推送断点快照
  - 插件在本地 18766 端口起 LobiCallbackServer，等待 POST /recommend
  - 后端通过 POST localhost:18766/recommend 向插件推送断点推荐
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/debug", tags=["Debug Bridge"])

# ── 内存缓存（最近 20 条断点快照）────────────────────────────────────────────
_snapshots: deque[dict[str, Any]] = deque(maxlen=20)
_snapshot_event = asyncio.Event()   # 新快照到来时 set，供 wait_for_breakpoint 轮询

# debuggerPlugin LobiCallbackServer 地址
_LOBI_CALLBACK_URL = "http://localhost:18766/recommend"


# ── Schema ────────────────────────────────────────────────────────────────────

class SnapshotPayload(BaseModel):
    """
    debuggerPlugin 推送的断点快照格式（来自 AiAnalyzerClient）。
    兼容两种格式：
      1. { "snapshot": {...}, "mode": "auto" }   — 单断点
      2. { "session": "...", "breakpoints": [...] } — 多断点 diff 格式
    """
    model_config = {"extra": "allow"}


class RecommendRequest(BaseModel):
    """Agent 请求向 AS 推送断点推荐。"""
    file: str
    line: int
    reason: str = ""


# ── 接口实现 ──────────────────────────────────────────────────────────────────

@router.post("/snapshot")
async def receive_snapshot(request: Request):
    """
    接收 debuggerPlugin 推送的断点快照。
    插件配置 API Endpoint 为 http://localhost:8000/v1/debug/snapshot 即可。
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="请求体必须是合法 JSON")

    # 统一格式：加上接收时间戳
    snapshot = {**body, "_received_at": time.time()}
    _snapshots.append(snapshot)
    _snapshot_event.set()
    _snapshot_event.clear()

    logger.info(
        "debug snapshot received | file=%s line=%s",
        _extract_file(body),
        _extract_line(body),
    )
    # 返回 200（同步模式），插件不会进入轮询
    return {"status": "ok", "conclusion": "", "suggestion": ""}


@router.get("/snapshot/latest")
async def get_latest_snapshot():
    """返回最新的断点快照，供 Agent MCP 工具轮询。"""
    if not _snapshots:
        return {"has_snapshot": False, "snapshot": None}
    return {"has_snapshot": True, "snapshot": _snapshots[-1]}


@router.get("/snapshot/list")
async def list_snapshots(limit: int = 10):
    """返回最近 N 条断点快照列表。"""
    items = list(_snapshots)[-limit:]
    return {"count": len(items), "snapshots": items}


@router.post("/recommend")
async def send_recommend(body: RecommendRequest):
    """
    向 debuggerPlugin 的 LobiCallbackServer（18766端口）推送断点推荐。
    Agent 调用 set_breakpoint 工具时，后端通过此接口转发给 AS 插件。
    """
    payload = {
        "recommendations": [
            {"file": body.file, "line": body.line, "reason": body.reason}
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(_LOBI_CALLBACK_URL, json=payload)
            if resp.is_success:
                logger.info("recommend sent to AS | file=%s line=%d", body.file, body.line)
                return {"status": "ok", "message": f"已推送断点推荐到 Android Studio：{body.file}:{body.line}"}
            else:
                return {"status": "error", "message": f"AS 插件返回错误：HTTP {resp.status_code}"}
    except httpx.ConnectError:
        return {
            "status": "not_connected",
            "message": "Android Studio 插件未连接（18766端口无响应），请确认插件已安装并 AS 正在运行",
        }
    except Exception as e:
        logger.error("recommend failed | error=%s", e)
        raise HTTPException(status_code=500, detail=f"推送失败：{e}")


# ── 内部工具函数 ──────────────────────────────────────────────────────────────

def _extract_file(body: dict) -> str:
    """从快照 body 中提取文件名（兼容两种格式）。"""
    if "snapshot" in body:
        return body["snapshot"].get("file", "unknown")
    if "breakpoints" in body and body["breakpoints"]:
        loc = body["breakpoints"][0].get("location", "")
        return loc.split(" · ")[0] if " · " in loc else loc
    return "unknown"


def _extract_line(body: dict) -> int:
    """从快照 body 中提取行号（兼容两种格式）。"""
    if "snapshot" in body:
        return body["snapshot"].get("line", -1)
    if "breakpoints" in body and body["breakpoints"]:
        loc = body["breakpoints"][0].get("location", "")
        parts = loc.split(" · ")
        if len(parts) >= 3:
            return int(parts[2].lstrip("L")) if parts[2].startswith("L") else -1
    return -1


def get_snapshots_deque() -> deque:
    """供 MCP 工具直接访问快照缓存（避免 HTTP 内部调用）。"""
    return _snapshots


def get_snapshot_event() -> asyncio.Event:
    """供 wait_for_breakpoint 工具等待新快照事件。"""
    return _snapshot_event
