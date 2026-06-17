"""forward_message — Agent 转发消息工具。

当 Agent 对话中用户要求将消息转发给对方时，调用此工具。
工具会以 msg_type='agent_forward' 写入一条消息，并附带 forward_from 字段（发起转发的用户 ID）。
对方收到后，前端以特殊气泡样式展示「TA 的 Agent，转发自 [我]」。

注册方式：模块被 import 时自动注册到全局 tool_registry。
调用方（agent.py 的流式接口）在 tool_calls 阶段执行此工具。

工具参数：
  receiver_id  — 接收方用户 ID（即 Agent 对话中的 peerId）
  content      — 要转发的消息内容
  sender_id    — 发起转发的用户 ID（即当前登录用户）
"""
from __future__ import annotations

import logging
import uuid

import aiosqlite

from app.services.corwork_db import _DB_PATH, now_iso
from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)


# ── 工具处理函数 ──────────────────────────────────────────────────────────────

async def _handle_forward_message(
    receiver_id: str,
    content: str,
    sender_id: str,
) -> str:
    """
    将消息以 agent_forward 类型写入数据库，并通过 WebSocket 推送给接收方。
    返回操作结果描述字符串（供 LLM 读取）。
    """
    if not receiver_id or not content or not sender_id:
        return "[错误] 缺少必要参数：receiver_id、content、sender_id 均不能为空"

    msg_id = str(uuid.uuid4())
    ts = now_iso()

    # 会话 ID：两个 user_id 排序后拼接（与 collab.py 保持一致）
    conv_id = "_".join(sorted([sender_id, receiver_id]))

    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute(
                """INSERT INTO messages
                   (id, conversation_id, sender_id, receiver_id, content, msg_type, is_agent_reply, forward_from, created_at)
                   VALUES (?,?,?,?,?,?,1,?,?)""",
                (msg_id, conv_id, sender_id, receiver_id, content, "agent_forward", sender_id, ts),
            )
            await db.commit()

        logger.info(
            "forward_message: sent | msg_id=%s sender=%s receiver=%s",
            msg_id, sender_id, receiver_id,
        )
    except Exception as e:
        logger.error("forward_message: db error | %s", e)
        return f"[错误] 消息写入失败：{e}"

    # 通过 WebSocket 推送给接收方（如果在线）
    try:
        from app.api.v1.collab import _ws_manager  # 延迟导入，避免循环依赖

        msg_payload = {
            "id": msg_id,
            "conversation_id": conv_id,
            "sender_id": sender_id,
            "receiver_id": receiver_id,
            "content": content,
            "msg_type": "agent_forward",
            "is_agent_reply": 1,
            "forward_from": sender_id,
            "created_at": ts,
        }
        await _ws_manager.broadcast_to_user(receiver_id, {"type": "new_message", "data": msg_payload})
    except Exception as e:
        logger.warning("forward_message: ws push failed (non-fatal) | %s", e)

    return f"✅ 消息已成功转发给对方（消息 ID：{msg_id}）。内容：「{content[:80]}{'...' if len(content) > 80 else ''}」"


# ── 注册到全局 tool_registry ──────────────────────────────────────────────────

tool_registry.register(
    ToolDefinition(
        name="forward_message",
        description=(
            "将用户的消息通过 Agent 转发给指定联系人。"
            "当用户在 Agent 对话中明确要求转发消息时调用此工具。"
            "转发后对方会看到一条特殊标注的消息，显示「TA 的 Agent，转发自 [发起人]」。"
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
                    "description": "要转发的消息内容，应是经过整理和确认的最终文本",
                },
                "sender_id": {
                    "type": "string",
                    "description": "发起转发的用户 ID（当前登录用户的 ID）",
                },
            },
            "required": ["receiver_id", "content", "sender_id"],
        },
        handler=_handle_forward_message,
    )
)

logger.info("tool registered | name=forward_message")
