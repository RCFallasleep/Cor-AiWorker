"""send_direct_message — Agent 直接发送普通消息工具。

当 Agent 对话中用户要求将消息直接发给对方本人（而非对方 Agent 收件箱）时，调用此工具。
工具会：
  1. 以 msg_type='text' 写入一条普通消息（对方聊天列表可见，显示为普通气泡）
  2. 通过 WebSocket 实时推送给对方

与 forward_message 的区别：
  - forward_message：写入 Agent 收件箱 + 聊天列表显示紫色「Agent 转发」气泡
  - send_direct_message：只写普通消息，聊天列表显示普通文字气泡，对方感知不到是 Agent 代发

注册方式：模块被 import 时自动注册到全局 tool_registry。

工具参数：
  receiver_id  — 接收方用户 ID（即 Agent 对话中的 peerId）
  content      — 要发送的消息内容
  sender_id    — 发起发送的用户 ID（即当前登录用户，由系统自动注入）
"""
from __future__ import annotations

import logging
import uuid

import aiosqlite

from app.services.corwork_db import _DB_PATH, now_iso
from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)


# ── 工具处理函数 ──────────────────────────────────────────────────────────────

async def _handle_send_direct_message(
    receiver_id: str,
    content: str,
    sender_id: str,
) -> str:
    """
    将消息以普通 text 类型写入数据库，并通过 WebSocket 推送给接收方。
    不写入 Agent 收件箱，对方聊天列表看到普通文字气泡。
    返回操作结果描述字符串（供 LLM 读取）。
    """
    if not receiver_id or not content or not sender_id:
        return "[错误] 缺少必要参数：receiver_id、content、sender_id 均不能为空"

    msg_id = str(uuid.uuid4())
    ts = now_iso()

    # 会话 ID：两个 user_id 排序后拼接（与 collab.py 保持一致）
    conv_id = "_".join(sorted([sender_id, receiver_id]))

    # ── 写入普通消息表（对方聊天列表可见，普通气泡） ──────────────────────────
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute(
                """INSERT INTO messages
                   (id, conversation_id, sender_id, receiver_id, content, msg_type, is_agent_reply, created_at)
                   VALUES (?,?,?,?,?,?,1,?)""",
                (msg_id, conv_id, sender_id, receiver_id, content, "text", ts),
            )
            await db.commit()

        logger.info(
            "send_direct_message: sent to messages | msg_id=%s sender=%s receiver=%s",
            msg_id, sender_id, receiver_id,
        )
    except Exception as e:
        logger.error("send_direct_message: db error | %s", e)
        return f"[错误] 消息写入失败：{e}"

    # ── WebSocket 推送 ─────────────────────────────────────────────────────────
    try:
        from app.api.v1.collab import _ws_manager  # 延迟导入，避免循环依赖

        msg_payload = {
            "id": msg_id,
            "conversation_id": conv_id,
            "sender_id": sender_id,
            "receiver_id": receiver_id,
            "content": content,
            "msg_type": "text",
            "is_agent_reply": 1,
            "forward_from": None,
            "created_at": ts,
        }
        await _ws_manager.broadcast_to_user(receiver_id, {"type": "new_message", "data": msg_payload})

    except Exception as e:
        logger.warning("send_direct_message: ws push failed (non-fatal) | %s", e)

    return f"✅ 消息已直接发送给对方（普通消息通道），对方聊天列表将看到普通气泡（消息 ID：{msg_id}）。内容：「{content[:80]}{'...' if len(content) > 80 else ''}」"


# ── 注册到全局 tool_registry ──────────────────────────────────────────────────

tool_registry.register(
    ToolDefinition(
        name="send_direct_message",
        description=(
            "将用户的消息以普通消息形式直接发送给指定联系人本人（不经过 Agent 收件箱）。"
            "对方聊天列表会看到普通文字气泡，感知不到是 Agent 代发。"
            "适用场景：用户希望以自己的名义直接发送消息，不想让对方知道是 Agent 起草的。"
            "与 forward_message 的区别：forward_message 会写入对方 Agent 收件箱并显示紫色气泡；"
            "send_direct_message 只发普通消息，对方看到的是普通聊天气泡。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "receiver_id": {
                    "type": "string",
                    "description": "接收方的用户 ID（即当前 Agent 对话的 peerId）",
                },
                "content": {
                    "type": "string",
                    "description": "要发送的消息内容，应是经过整理和确认的最终文本",
                },
                "sender_id": {
                    "type": "string",
                    "description": "发送方用户 ID（当前登录用户的 ID，由系统自动注入，无需填写）",
                },
            },
            "required": ["receiver_id", "content", "sender_id"],
        },
        handler=_handle_send_direct_message,
    )
)

logger.info("tool registered | name=send_direct_message")
