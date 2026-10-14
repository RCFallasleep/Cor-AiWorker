"""save_memory — Agent 记忆保存工具。

当 Agent 对话中用户说「记住这个」「把这条存到记忆」等指令时，调用此工具。
工具会将指定内容写入 agent_memories 表，供后续对话注入或在 Agent 养成页查看。

注册方式：模块被 import 时自动注册到全局 tool_registry。
调用方（agent.py 的流式接口）在 tool_calls 阶段执行此工具。

工具参数：
  user_id  — 记忆归属的用户 ID（当前登录用户）
  type     — 记忆类型：soul / memory / user / common
  content  — 记忆内容
  title    — 记忆标题（可选，默认为空字符串）
"""
from __future__ import annotations

import logging
import uuid

import aiosqlite

from app.services.corwork_db import _DB_PATH, now_iso
from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)

# 合法的记忆类型
_VALID_TYPES = {"soul", "memory", "user", "common"}


# ── 工具处理函数 ──────────────────────────────────────────────────────────────

async def _handle_save_memory(
    user_id: str,
    type: str,
    content: str,
    title: str = "",
) -> str:
    """
    将记忆条目写入 agent_memories 表。
    返回操作结果描述字符串（供 LLM 读取）。
    """
    if not user_id or not content:
        return "[错误] 缺少必要参数：user_id 和 content 均不能为空"

    if type not in _VALID_TYPES:
        return f"[错误] 无效的记忆类型 '{type}'，合法值为：soul / memory / user / common"

    mem_id = str(uuid.uuid4())
    ts = now_iso()
    safe_title = title.strip() if title else ""

    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute(
                """INSERT INTO agent_memories
                   (id, user_id, agent_id, type, title, content, created_at, updated_at)
                   VALUES (?,?,NULL,?,?,?,?,?)""",
                (mem_id, user_id, type, safe_title, content, ts, ts),
            )
            await db.commit()

        logger.info(
            "save_memory: saved | mem_id=%s user=%s type=%s",
            mem_id, user_id, type,
        )
    except Exception as e:
        logger.error("save_memory: db error | %s", e)
        return f"[错误] 记忆写入失败：{e}"

    type_label = {
        "soul": "Agent 人设",
        "memory": "Agent 经历",
        "user": "用户性格",
        "common": "公共记忆",
    }.get(type, type)

    title_part = f"「{safe_title}」" if safe_title else ""
    return (
        f"✅ 已成功保存{type_label}记忆{title_part}（ID：{mem_id}）。"
        f"内容：「{content[:80]}{'...' if len(content) > 80 else ''}」"
    )


# ── 注册到全局 tool_registry ──────────────────────────────────────────────────

tool_registry.register(
    ToolDefinition(
        name="save_memory",
        description=(
            "将重要信息保存为 Agent 记忆，供后续对话参考或在 Agent 养成页查看。"
            "当用户说「记住这个」「把这条存到记忆」「记录一下」等指令时调用此工具。"
            "type 参数决定记忆归属：common（公共记忆，对方 Agent 可见）/ "
            "memory（Agent 自身经历）/ user（用户性格特征）/ soul（Agent 人设）。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "user_id": {
                    "type": "string",
                    "description": "记忆归属的用户 ID（当前登录用户的 ID）",
                },
                "type": {
                    "type": "string",
                    "enum": ["soul", "memory", "user", "common"],
                    "description": (
                        "记忆类型：\n"
                        "- common：公共记忆，对方 Agent 起草消息时会自动注入\n"
                        "- memory：Agent 自身的经历/对话记忆\n"
                        "- user：用户的性格/偏好记忆\n"
                        "- soul：Agent 的人设/性格（通常不通过对话修改）"
                    ),
                },
                "content": {
                    "type": "string",
                    "description": "要保存的记忆内容，应简洁准确地描述需要记住的信息",
                },
                "title": {
                    "type": "string",
                    "description": "记忆标题（可选），用于在记忆列表中快速识别，留空则自动省略",
                },
            },
            "required": ["user_id", "type", "content"],
        },
        handler=_handle_save_memory,
    )
)

logger.info("tool registered | name=save_memory")
