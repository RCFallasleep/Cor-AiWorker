"""协作模块接口：Agent 名片、联系人、消息、WebSocket 实时推送。"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.services.corwork_db import _DB_PATH, now_iso
from app.services.user_service import get_user_by_username

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/collab", tags=["Collab"])

CurrentUser = Annotated[dict, Depends(get_current_user)]


# ══════════════════════════════════════════════════════════════════════════════
# Agent 名片
# ══════════════════════════════════════════════════════════════════════════════

class AgentProfileUpdate(BaseModel):
    name: str = Field(..., max_length=32)
    description: str = Field(default="", max_length=500)
    personality: str = Field(default="", max_length=1000)
    avatar_url: str | None = None


@router.get("/agent-profile", summary="获取我的 Agent 名片")
async def get_my_agent_profile(current_user: CurrentUser):
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM agent_profiles WHERE user_id = ?",
            (current_user["id"],),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Agent 名片不存在")
        return dict(row)


@router.put("/agent-profile", summary="更新我的 Agent 名片")
async def update_agent_profile(body: AgentProfileUpdate, current_user: CurrentUser):
    ts = now_iso()
    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute(
            """UPDATE agent_profiles
               SET name=?, description=?, personality=?, avatar_url=?, updated_at=?
               WHERE user_id=?""",
            (body.name, body.description, body.personality, body.avatar_url, ts, current_user["id"]),
        )
        await db.commit()
    return {"ok": True}


@router.get("/agent-profile/{user_id}", summary="查看指定用户的 Agent 名片")
async def get_agent_profile(user_id: str, current_user: CurrentUser):
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, user_id, name, avatar_url, description, mode, created_at FROM agent_profiles WHERE user_id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Agent 名片不存在")
        return dict(row)


# ══════════════════════════════════════════════════════════════════════════════
# 好友申请
# ══════════════════════════════════════════════════════════════════════════════

class FriendRequestBody(BaseModel):
    username: str
    message: str = Field(default="", max_length=200)


class FriendRequestAction(BaseModel):
    action: str  # accept / reject


@router.post("/friend-requests", summary="发送好友申请")
async def send_friend_request(body: FriendRequestBody, current_user: CurrentUser):
    target = await get_user_by_username(body.username)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="不能添加自己")

    uid = current_user["id"]
    tid = target["id"]
    ts = now_iso()

    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")

        # 检查是否已是好友
        cur = await db.execute(
            "SELECT id FROM contacts WHERE owner_id=? AND contact_user_id=?", (uid, tid)
        )
        if await cur.fetchone():
            raise HTTPException(status_code=409, detail="已是好友")

        # 检查是否已有 pending 申请
        cur = await db.execute(
            "SELECT id, status FROM friend_requests WHERE from_id=? AND to_id=?", (uid, tid)
        )
        existing = await cur.fetchone()
        if existing:
            if existing["status"] == "pending":
                raise HTTPException(status_code=409, detail="已发送过申请，等待对方同意")
            # 之前被拒绝/取消，允许重新申请
            await db.execute(
                "UPDATE friend_requests SET status='pending', message=?, updated_at=? WHERE from_id=? AND to_id=?",
                (body.message, ts, uid, tid),
            )
            req_id = existing["id"]
        else:
            req_id = str(uuid.uuid4())
            await db.execute(
                "INSERT INTO friend_requests (id, from_id, to_id, message, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (req_id, uid, tid, body.message, "pending", ts, ts),
            )

        await db.commit()

        # 查询申请详情（含发送方信息）
        cur = await db.execute(
            """SELECT fr.*, u.username as from_username, u.display_name as from_display_name,
                      ap.name as from_agent_name
               FROM friend_requests fr
               JOIN users u ON u.id = fr.from_id
               LEFT JOIN agent_profiles ap ON ap.user_id = fr.from_id
               WHERE fr.id=?""",
            (req_id,),
        )
        req = dict(await cur.fetchone())

    # WebSocket 推送给对方
    await _ws_manager.broadcast_to_user(tid, {"type": "friend_request", "data": req})
    return req


@router.get("/friend-requests/pending", summary="查看收到的待处理好友申请")
async def list_pending_requests(current_user: CurrentUser):
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT fr.id, fr.from_id, fr.message, fr.created_at,
                      u.username as from_username, u.display_name as from_display_name,
                      u.avatar_url as from_avatar,
                      ap.name as from_agent_name
               FROM friend_requests fr
               JOIN users u ON u.id = fr.from_id
               LEFT JOIN agent_profiles ap ON ap.user_id = fr.from_id
               WHERE fr.to_id=? AND fr.status='pending'
               ORDER BY fr.created_at DESC""",
            (current_user["id"],),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


@router.get("/friend-requests/sent", summary="查看我发出的好友申请")
async def list_sent_requests(current_user: CurrentUser):
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT fr.id, fr.to_id, fr.message, fr.status, fr.created_at, fr.updated_at,
                      u.username as to_username, u.display_name as to_display_name,
                      u.avatar_url as to_avatar
               FROM friend_requests fr
               JOIN users u ON u.id = fr.to_id
               WHERE fr.from_id=?
               ORDER BY fr.updated_at DESC""",
            (current_user["id"],),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


@router.post("/friend-requests/{request_id}/action", summary="同意或拒绝好友申请")
async def handle_friend_request(
    request_id: str,
    body: FriendRequestAction,
    current_user: CurrentUser,
):
    if body.action not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="action 必须是 accept 或 reject")

    uid = current_user["id"]
    ts = now_iso()

    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")

        cur = await db.execute(
            "SELECT * FROM friend_requests WHERE id=? AND to_id=? AND status='pending'",
            (request_id, uid),
        )
        req = await cur.fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="申请不存在或已处理")

        from_id = req["from_id"]
        new_status = "accepted" if body.action == "accept" else "rejected"

        await db.execute(
            "UPDATE friend_requests SET status=?, updated_at=? WHERE id=?",
            (new_status, ts, request_id),
        )

        if body.action == "accept":
            # 双向写入 contacts
            for owner, contact in [(uid, from_id), (from_id, uid)]:
                try:
                    await db.execute(
                        "INSERT INTO contacts (id, owner_id, contact_user_id, created_at) VALUES (?,?,?,?)",
                        (str(uuid.uuid4()), owner, contact, ts),
                    )
                except Exception as e:
                    if "UNIQUE constraint failed" not in str(e):
                        raise

        await db.commit()

        # 查询双方信息用于推送
        cur = await db.execute(
            """SELECT u.id, u.username, u.display_name, ap.name as agent_name
               FROM users u LEFT JOIN agent_profiles ap ON ap.user_id=u.id
               WHERE u.id=?""",
            (uid,),
        )
        acceptor = dict(await cur.fetchone())

    # 推送给申请方
    await _ws_manager.broadcast_to_user(
        from_id,
        {
            "type": "friend_request_result",
            "data": {
                "request_id": request_id,
                "action": body.action,
                "by": acceptor,
            },
        },
    )
    return {"ok": True, "status": new_status}


@router.delete("/friend-requests/{request_id}", summary="撤回好友申请（发送方取消）")
async def cancel_friend_request(request_id: str, current_user: CurrentUser):
    async with aiosqlite.connect(_DB_PATH) as db:
        cur = await db.execute(
            "SELECT id FROM friend_requests WHERE id=? AND from_id=? AND status='pending'",
            (request_id, current_user["id"]),
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=404, detail="申请不存在或已处理")
        await db.execute(
            "UPDATE friend_requests SET status='cancelled', updated_at=? WHERE id=?",
            (now_iso(), request_id),
        )
        await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# 联系人（好友关系管理）
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/contacts", summary="获取我的联系人列表")
async def list_contacts(current_user: CurrentUser):
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT c.id, c.contact_user_id, c.remark, c.created_at,
                      u.username, u.display_name, u.avatar_url, u.last_seen_at,
                      ap.name as agent_name, ap.avatar_url as agent_avatar, ap.description as agent_desc
               FROM contacts c
               JOIN users u ON u.id = c.contact_user_id
               LEFT JOIN agent_profiles ap ON ap.user_id = c.contact_user_id
               WHERE c.owner_id = ?
               ORDER BY c.created_at DESC""",
            (current_user["id"],),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


@router.delete("/contacts/{contact_user_id}", summary="删除好友（双向清除关系）")
async def remove_contact(
    contact_user_id: str,
    current_user: CurrentUser,
    mutual: bool = Query(default=True, description="True=双向删除，False=仅删自己这侧（单向屏蔽）"),
):
    """
    清理好友关系。
    - mutual=True（默认）：双向删除，双方都看不到对方
    - mutual=False：仅删自己这侧，对方仍可看到你（单向屏蔽）
    同时将历史申请记录标记为 cancelled，方便重新申请。
    """
    uid = current_user["id"]
    tid = contact_user_id
    ts = now_iso()

    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        # 删自己这侧
        await db.execute(
            "DELETE FROM contacts WHERE owner_id=? AND contact_user_id=?", (uid, tid)
        )
        if mutual:
            # 删对方那侧
            await db.execute(
                "DELETE FROM contacts WHERE owner_id=? AND contact_user_id=?", (tid, uid)
            )
        # 清理申请记录（双向），方便未来重新申请
        await db.execute(
            "UPDATE friend_requests SET status='cancelled', updated_at=? WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)",
            (ts, uid, tid, tid, uid),
        )
        await db.commit()

    # 推送给对方（如果是双向删除）
    if mutual:
        await _ws_manager.broadcast_to_user(
            tid,
            {"type": "friend_removed", "data": {"by_user_id": uid}},
        )
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# 消息
# ══════════════════════════════════════════════════════════════════════════════

def _make_conversation_id(user_a: str, user_b: str) -> str:
    """会话 ID：两个 user_id 排序后拼接，保证双向唯一。"""
    return "_".join(sorted([user_a, user_b]))


class SendMessageRequest(BaseModel):
    receiver_id: str
    content: str = Field(..., min_length=1, max_length=10000)
    msg_type: str = Field(default="text")


@router.get("/messages/{peer_id}", summary="获取与某用户的消息历史")
async def get_messages(
    peer_id: str,
    current_user: CurrentUser,
    limit: int = Query(default=50, le=200),
    before: str | None = Query(default=None, description="消息 ID，获取此消息之前的记录"),
):
    conv_id = _make_conversation_id(current_user["id"], peer_id)
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if before:
            # 获取 before 消息的时间戳
            cur = await db.execute("SELECT created_at FROM messages WHERE id=?", (before,))
            ref = await cur.fetchone()
            if ref:
                cursor = await db.execute(
                    """SELECT * FROM messages WHERE conversation_id=? AND created_at < ?
                       ORDER BY created_at DESC LIMIT ?""",
                    (conv_id, ref["created_at"], limit),
                )
            else:
                cursor = await db.execute(
                    "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?",
                    (conv_id, limit),
                )
        else:
            cursor = await db.execute(
                "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?",
                (conv_id, limit),
            )
        rows = await cursor.fetchall()
        msgs = [dict(r) for r in rows]
        msgs.reverse()  # 返回升序

        # 标记已读
        await db.execute(
            "UPDATE messages SET read_at=? WHERE conversation_id=? AND receiver_id=? AND read_at IS NULL",
            (now_iso(), conv_id, current_user["id"]),
        )
        await db.commit()
        return msgs


@router.post("/messages", summary="发送消息")
async def send_message(body: SendMessageRequest, current_user: CurrentUser):
    msg_id = str(uuid.uuid4())
    conv_id = _make_conversation_id(current_user["id"], body.receiver_id)
    ts = now_iso()

    async with aiosqlite.connect(_DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute(
            """INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, msg_type, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (msg_id, conv_id, current_user["id"], body.receiver_id, body.content, body.msg_type, ts),
        )
        await db.commit()

    msg = {
        "id": msg_id,
        "conversation_id": conv_id,
        "sender_id": current_user["id"],
        "receiver_id": body.receiver_id,
        "content": body.content,
        "msg_type": body.msg_type,
        "is_agent_reply": 0,
        "created_at": ts,
    }

    # 推送给接收方（如果在线）
    await _ws_manager.broadcast_to_user(body.receiver_id, {"type": "new_message", "data": msg})
    # 触发 Agent 模拟回复（异步，不阻塞响应）
    asyncio.create_task(_agent_auto_reply(current_user, body.receiver_id, body.content, conv_id))

    return msg


@router.get("/conversations", summary="获取会话列表（每个联系人最新一条消息）")
async def list_conversations(current_user: CurrentUser):
    """返回当前用户所有会话，每个会话包含最新消息和未读数。"""
    uid = current_user["id"]
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # 找出所有与我有消息往来的用户
        cursor = await db.execute(
            """SELECT DISTINCT
                 CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END as peer_id
               FROM messages
               WHERE sender_id=? OR receiver_id=?""",
            (uid, uid, uid),
        )
        peer_rows = await cursor.fetchall()
        peer_ids = [r["peer_id"] for r in peer_rows]

        result = []
        for peer_id in peer_ids:
            conv_id = _make_conversation_id(uid, peer_id)
            # 最新消息
            cur = await db.execute(
                "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1",
                (conv_id,),
            )
            last_msg = await cur.fetchone()
            # 未读数
            cur2 = await db.execute(
                "SELECT COUNT(*) FROM messages WHERE conversation_id=? AND receiver_id=? AND read_at IS NULL",
                (conv_id, uid),
            )
            unread = (await cur2.fetchone())[0]
            # 对方用户信息
            cur3 = await db.execute(
                """SELECT u.id, u.username, u.display_name, u.avatar_url,
                          ap.name as agent_name, ap.avatar_url as agent_avatar
                   FROM users u
                   LEFT JOIN agent_profiles ap ON ap.user_id = u.id
                   WHERE u.id=?""",
                (peer_id,),
            )
            peer_info = await cur3.fetchone()
            if last_msg and peer_info:
                result.append({
                    "peer": dict(peer_info),
                    "last_message": dict(last_msg),
                    "unread_count": unread,
                })

        # 按最新消息时间排序
        result.sort(key=lambda x: x["last_message"]["created_at"], reverse=True)
        return result


# ══════════════════════════════════════════════════════════════════════════════
# WebSocket 连接管理
# ══════════════════════════════════════════════════════════════════════════════

class _WSManager:
    """管理所有在线 WebSocket 连接，按 user_id 索引。"""

    def __init__(self):
        # user_id -> set of WebSocket
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self._connections.setdefault(user_id, set()).add(ws)
        logger.info("ws: connected | user_id=%s total=%d", user_id, len(self._connections))

    def disconnect(self, user_id: str, ws: WebSocket):
        if user_id in self._connections:
            self._connections[user_id].discard(ws)
            if not self._connections[user_id]:
                del self._connections[user_id]
        logger.info("ws: disconnected | user_id=%s", user_id)

    async def broadcast_to_user(self, user_id: str, payload: dict):
        """向指定用户的所有连接推送消息。"""
        sockets = self._connections.get(user_id, set()).copy()
        dead = set()
        for ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections.get(user_id, set()).discard(ws)

    def online_users(self) -> list[str]:
        return list(self._connections.keys())


_ws_manager = _WSManager()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str | None = None):
    """WebSocket 实时推送端点。
    连接时通过 ?token=<jwt> 认证。
    """
    from app.services.user_service import decode_token, get_user_by_id

    if not token:
        await ws.close(code=4001, reason="缺少 token")
        return

    payload = decode_token(token)
    if not payload:
        await ws.close(code=4001, reason="token 无效")
        return

    user = await get_user_by_id(payload["sub"])
    if not user:
        await ws.close(code=4001, reason="用户不存在")
        return

    user_id = user["id"]
    await _ws_manager.connect(user_id, ws)
    try:
        # 发送在线确认
        await ws.send_json({"type": "connected", "user_id": user_id})
        # 保持连接，等待客户端消息（心跳 ping）
        while True:
            data = await ws.receive_json()
            if data.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        _ws_manager.disconnect(user_id, ws)


# ══════════════════════════════════════════════════════════════════════════════
# Agent 模拟回复（本地模式，预留平台接入口）
# ══════════════════════════════════════════════════════════════════════════════

async def _agent_auto_reply(sender: dict, receiver_id: str, content: str, conv_id: str):
    """
    模拟对方 Agent 自动回复。

    当前模式（local）：用本地 LLM 模拟对方 Agent 回复。
    未来平台模式（platform）：通过 endpoint_url 调用对方设备的 Agent。
    """
    try:
        # 查询对方的 Agent 名片
        async with aiosqlite.connect(_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT ap.*, u.display_name FROM agent_profiles ap JOIN users u ON u.id=ap.user_id WHERE ap.user_id=?",
                (receiver_id,),
            )
            profile = await cur.fetchone()

        if not profile:
            return

        mode = profile["mode"]

        if mode == "platform":
            # TODO: 未来平台化接入口
            # 向 profile["endpoint_url"] 发送请求，由对方设备的 Agent 处理
            logger.info("agent_reply: platform mode not yet implemented | receiver=%s", receiver_id)
            return

        # local 模式：用本地 LLM 生成回复（暂时用简单占位回复）
        # 实际接入时，这里调用 chat_service.stream_chat，使用发送方的 API Key
        await asyncio.sleep(1)  # 模拟思考延迟

        reply_content = f"[{profile['name']}] 收到你的消息：「{content[:50]}」，我稍后处理。"

        msg_id = str(uuid.uuid4())
        ts = now_iso()
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute(
                """INSERT INTO messages (id, conversation_id, sender_id, receiver_id, content, msg_type, is_agent_reply, created_at)
                   VALUES (?,?,?,?,?,?,1,?)""",
                (msg_id, conv_id, receiver_id, sender["id"], reply_content, "text", ts),
            )
            await db.commit()

        reply_msg = {
            "id": msg_id,
            "conversation_id": conv_id,
            "sender_id": receiver_id,
            "receiver_id": sender["id"],
            "content": reply_content,
            "msg_type": "text",
            "is_agent_reply": 1,
            "created_at": ts,
        }
        # 推送给发送方
        await _ws_manager.broadcast_to_user(sender["id"], {"type": "new_message", "data": reply_msg})

    except Exception as e:
        logger.error("agent_auto_reply failed | %s", e)


# ══════════════════════════════════════════════════════════════════════════════
# 用户搜索（添加联系人时用）
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/users/search", summary="搜索用户（按用户名）")
async def search_users(
    q: str = Query(..., min_length=1),
    current_user: CurrentUser = None,
):
    async with aiosqlite.connect(_DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """SELECT u.id, u.username, u.display_name, u.avatar_url,
                      ap.name as agent_name, ap.avatar_url as agent_avatar
               FROM users u
               LEFT JOIN agent_profiles ap ON ap.user_id = u.id
               WHERE u.username LIKE ? AND u.id != ?
               LIMIT 20""",
            (f"%{q}%", current_user["id"]),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
