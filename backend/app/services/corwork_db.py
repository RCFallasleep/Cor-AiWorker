"""Cor-AiWorker 平台核心数据库（SQLite）。

统一管理以下数据：
  - users            用户账号
  - agent_profiles   Agent 名片（每个用户对外展示的 Agent 身份）
  - friend_requests  好友申请（pending/accepted/rejected）
  - contacts         联系人关系（双向，accepted 后各写一条）
  - messages         消息记录
  - agent_memories   Agent 记忆（soul/memory/user/common 四层）
  - projects         协作项目
  - project_members  项目成员

设计原则：
  - 单文件 SQLite（/data/corwork.db），WAL 模式支持并发读
  - 所有写操作通过 aiosqlite 异步执行
  - 表结构幂等初始化，支持热升级
"""
from __future__ import annotations

import logging
import os
from datetime import datetime

import aiosqlite

from app.core.config import settings

logger = logging.getLogger(__name__)

_DB_PATH = settings.corwork_db_path


# ── 初始化 ────────────────────────────────────────────────────────────────────

async def init_db() -> None:
    """创建所有表（幂等），应用启动时调用一次。"""
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)

    async with aiosqlite.connect(_DB_PATH) as db:
        # WAL 模式：支持多读单写并发
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        # ── 用户表 ────────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           TEXT PRIMARY KEY,
                username     TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL DEFAULT '',
                email        TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                avatar_url   TEXT,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                last_seen_at TEXT
            )
        """)

        # ── Agent 名片表 ──────────────────────────────────────────────────────
        # 每个用户有一个对外展示的 Agent 身份
        # 未来平台化时，其他用户的 Agent 通过此表发现和调用
        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_profiles (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name         TEXT NOT NULL,
                avatar_url   TEXT,
                description  TEXT NOT NULL DEFAULT '',
                personality  TEXT NOT NULL DEFAULT '',
                -- 预留：未来平台化时的接入端点
                endpoint_url TEXT,
                -- local / platform（local=本机模拟，platform=真实远端）
                mode         TEXT NOT NULL DEFAULT 'local',
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
        """)
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_user ON agent_profiles(user_id)"
        )

        # ── 好友申请表 ────────────────────────────────────────────────────────
        # status: pending / accepted / rejected / cancelled
        await db.execute("""
            CREATE TABLE IF NOT EXISTS friend_requests (
                id          TEXT PRIMARY KEY,
                from_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                to_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                message     TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'pending',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                UNIQUE(from_id, to_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_freq_to ON friend_requests(to_id, status)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_freq_from ON friend_requests(from_id, status)"
        )

        # ── 联系人表 ──────────────────────────────────────────────────────────
        # 双向关系：A-B 好友后，各写一条（owner_id=A,contact=B 和 owner_id=B,contact=A）
        # 删除好友时两条都删，或只删自己那条（单向屏蔽）
        await db.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id              TEXT PRIMARY KEY,
                owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                contact_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                remark          TEXT,
                created_at      TEXT NOT NULL,
                UNIQUE(owner_id, contact_user_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id)"
        )

        # ── 消息表 ────────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id           TEXT PRIMARY KEY,
                -- 会话标识：由 sender_id 和 receiver_id 排序后拼接，保证唯一
                conversation_id TEXT NOT NULL,
                sender_id    TEXT NOT NULL REFERENCES users(id),
                receiver_id  TEXT NOT NULL REFERENCES users(id),
                content      TEXT NOT NULL,
                -- text / image / file / agent_reply / agent_forward
                msg_type     TEXT NOT NULL DEFAULT 'text',
                -- 是否由 Agent 自动生成的回复
                is_agent_reply INTEGER NOT NULL DEFAULT 0,
                -- Agent 转发时，记录原始发起人的 user_id（msg_type=agent_forward 时有值）
                forward_from TEXT REFERENCES users(id),
                read_at      TEXT,
                created_at   TEXT NOT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read_at)"
        )

        # ── Agent 记忆表 ──────────────────────────────────────────────────────
        # type 说明：
        #   soul    — Agent 的性格/人设（固定，属于某个 agent_id）
        #   memory  — Agent 的经历/对话记忆（动态，属于某个 agent_id）
        #   user    — 用户性格记忆（属于某个 user_id，agent_id 为空）
        #   common  — 公共记忆（属于某个 user_id，跨 Agent 共享，供他人 Agent 对话时注入）
        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_memories (
                id         TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                -- soul/memory 类型时有值，user/common 类型时为空
                agent_id   TEXT,
                -- soul / memory / user / common
                type       TEXT NOT NULL DEFAULT 'memory',
                title      TEXT NOT NULL DEFAULT '',
                content    TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_user ON agent_memories(user_id, type)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, type)"
        )

        # ── 项目表 ────────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id           TEXT PRIMARY KEY,
                owner_id     TEXT NOT NULL REFERENCES users(id),
                name         TEXT NOT NULL,
                description  TEXT NOT NULL DEFAULT '',
                status       TEXT NOT NULL DEFAULT 'active',
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
        """)

        # ── 项目成员表 ────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS project_members (
                id         TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role       TEXT NOT NULL DEFAULT 'member',
                joined_at  TEXT NOT NULL,
                UNIQUE(project_id, user_id)
            )
        """)

        await db.commit()

        # ── 迁移检测：补全旧库缺失的表/列 ────────────────────────────────────
        # friend_requests 表（v2 新增）
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='friend_requests'"
        )
        if not await cur.fetchone():
            logger.info("corwork_db: migrating — creating friend_requests table")
            await db.execute("""
                CREATE TABLE friend_requests (
                    id          TEXT PRIMARY KEY,
                    from_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    to_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    message     TEXT NOT NULL DEFAULT '',
                    status      TEXT NOT NULL DEFAULT 'pending',
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL,
                    UNIQUE(from_id, to_id)
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_freq_to ON friend_requests(to_id, status)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_freq_from ON friend_requests(from_id, status)"
            )
            await db.commit()

        # agent_memories 表（v3 新增）
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memories'"
        )
        if not await cur.fetchone():
            logger.info("corwork_db: migrating — creating agent_memories table")
            await db.execute("""
                CREATE TABLE agent_memories (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    agent_id   TEXT,
                    type       TEXT NOT NULL DEFAULT 'memory',
                    title      TEXT NOT NULL DEFAULT '',
                    content    TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_memories_user ON agent_memories(user_id, type)"
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, type)"
            )
            await db.commit()

        # messages 表补 forward_from 列（v3 新增）
        cur = await db.execute("PRAGMA table_info(messages)")
        cols = [row[1] for row in await cur.fetchall()]
        if "forward_from" not in cols:
            logger.info("corwork_db: migrating — adding forward_from to messages")
            await db.execute("ALTER TABLE messages ADD COLUMN forward_from TEXT")
            await db.commit()

    logger.info("corwork_db: initialized | path=%s", _DB_PATH)


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


async def get_db_stats() -> dict:
    """返回数据库统计信息，供管理界面展示。"""
    if not os.path.exists(_DB_PATH):
        return {"error": "数据库文件不存在"}
    try:
        size_bytes = os.path.getsize(_DB_PATH)
        async with aiosqlite.connect(_DB_PATH) as db:
            stats = {}
            for table in ["users", "agent_profiles", "friend_requests", "contacts", "messages", "agent_memories", "projects"]:
                cursor = await db.execute(f"SELECT COUNT(*) FROM {table}")
                row = await cursor.fetchone()
                stats[table] = row[0] if row else 0
        return {
            "db_path": _DB_PATH,
            "db_size_kb": round(size_bytes / 1024, 1),
            "tables": stats,
        }
    except Exception as e:
        logger.error("corwork_db: get_stats failed | %s", e)
        return {"error": str(e)}
