"""Agent 记忆接口。

四层记忆模型：
  soul    — Agent 性格/人设（固定，属于某个 agent_id）
  memory  — Agent 经历/对话记忆（动态，属于某个 agent_id）
  user    — 用户性格记忆（属于当前用户，agent_id 为空）
  common  — 公共记忆（属于某个用户，跨 Agent 共享，供他人 Agent 对话时注入 Prompt）
"""
from __future__ import annotations

import uuid
from typing import Annotated, Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.services.corwork_db import _DB_PATH, now_iso

router = APIRouter(prefix="/memories", tags=["Memories"])

CurrentUser = Annotated[dict, Depends(get_current_user)]

MemoryType = Literal["soul", "memory", "user", "common"]


# ── Schema ────────────────────────────────────────────────────────────────────

class MemoryCreate(BaseModel):
    type: MemoryType
    title: str = Field(default="", max_length=100)
    content: str = Field(..., max_length=10000)
    agent_id: str | None = None   # soul/memory 类型时必填


class MemoryUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=100)
    content: str | None = Field(default=None, max_length=10000)


# ── 接口 ──────────────────────────────────────────────────────────────────────

@router.get("/me", summary="获取我的所有记忆（按 type 分组）")
async def get_my_memories(current_user: CurrentUser):
    """返回当前用户的所有记忆，按 type 分组为 {soul, memory, user, common}。"""
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT * FROM agent_memories
               WHERE user_id = ?
               ORDER BY type, updated_at DESC""",
            (uid,),
        )
        rows = await cursor.fetchall()

    result: dict[str, list] = {"soul": [], "memory": [], "user": [], "common": []}
    for row in rows:
        t = row["type"]
        if t in result:
            result[t].append(dict(row))
    return result


@router.get("/peer/{user_id}/common", summary="获取指定用户的公共记忆（供 Agent 对话注入 Prompt）")
async def get_peer_common_memories(user_id: str, current_user: CurrentUser):
    """获取指定联系人的 ComMemory，用于构建 Agent 对话的 System Prompt。"""
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT id, title, content, updated_at
               FROM agent_memories
               WHERE user_id = ? AND type = 'common'
               ORDER BY updated_at DESC""",
            (user_id,),
        )
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("", summary="新建记忆条目", status_code=201)
async def create_memory(body: MemoryCreate, current_user: CurrentUser):
    uid = current_user["id"]
    if body.type in ("soul", "memory") and not body.agent_id:
        raise HTTPException(status_code=422, detail="soul/memory 类型必须提供 agent_id")

    mem_id = str(uuid.uuid4())
    ts = now_iso()
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(
            """INSERT INTO agent_memories (id, user_id, agent_id, type, title, content, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (mem_id, uid, body.agent_id, body.type, body.title, body.content, ts, ts),
        )
        await db.commit()
    return {"id": mem_id, "user_id": uid, "agent_id": body.agent_id,
            "type": body.type, "title": body.title, "content": body.content,
            "created_at": ts, "updated_at": ts}


@router.put("/{memory_id}", summary="编辑记忆内容")
async def update_memory(memory_id: str, body: MemoryUpdate, current_user: CurrentUser):
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM agent_memories WHERE id = ? AND user_id = ?",
            (memory_id, uid),
        )
        row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="记忆不存在或无权限")

        new_title = body.title if body.title is not None else row["title"]
        new_content = body.content if body.content is not None else row["content"]
        ts = now_iso()
        await db.execute(
            "UPDATE agent_memories SET title=?, content=?, updated_at=? WHERE id=?",
            (new_title, new_content, ts, memory_id),
        )
        await db.commit()
    return {"id": memory_id, "title": new_title, "content": new_content, "updated_at": ts}


@router.delete("/{memory_id}", summary="删除记忆条目", status_code=204)
async def delete_memory(memory_id: str, current_user: CurrentUser):
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "SELECT id FROM agent_memories WHERE id = ? AND user_id = ?",
            (memory_id, uid),
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="记忆不存在或无权限")
        await db.execute("DELETE FROM agent_memories WHERE id = ?", (memory_id,))
        await db.commit()
