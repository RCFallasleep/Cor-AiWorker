"""用户账号服务：注册、登录、JWT 签发与验证。"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import aiosqlite
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.services.corwork_db import _DB_PATH, now_iso

logger = logging.getLogger(__name__)

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── 密码工具 ──────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_ctx.verify(plain, hashed)


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_access_token(user_id: str, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": user_id,
        "username": username,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


# ── 数据库操作 ────────────────────────────────────────────────────────────────

async def create_user(username: str, password: str, display_name: str = "", email: str | None = None) -> dict | None:
    """注册新用户，返回用户信息（不含密码）。用户名重复返回 None。"""
    user_id = str(uuid.uuid4())
    password_hash = hash_password(password)
    ts = now_iso()

    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute("PRAGMA foreign_keys=ON")
            await db.execute(
                """INSERT INTO users (id, username, display_name, email, password_hash, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (user_id, username, display_name or username, email, password_hash, ts, ts),
            )
            # 同时为新用户创建默认 Agent 名片
            profile_id = str(uuid.uuid4())
            await db.execute(
                """INSERT INTO agent_profiles (id, user_id, name, description, mode, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'local', ?, ?)""",
                (profile_id, user_id, f"{display_name or username} 的 Agent", "", ts, ts),
            )
            await db.commit()
        logger.info("user_service: user created | id=%s username=%s", user_id, username)
        return {"id": user_id, "username": username, "display_name": display_name or username, "email": email}
    except Exception as e:
        if "UNIQUE constraint failed" in str(e):
            logger.warning("user_service: username already exists | username=%s", username)
            return None
        logger.error("user_service: create_user failed | %s", e)
        raise


async def authenticate_user(username: str, password: str) -> dict | None:
    """验证用户名密码，成功返回用户信息，失败返回 None。"""
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, username, display_name, email, password_hash, avatar_url FROM users WHERE username = ?",
                (username,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            if not verify_password(password, row["password_hash"]):
                return None
            # 更新 last_seen_at
            await db.execute(
                "UPDATE users SET last_seen_at = ? WHERE id = ?",
                (now_iso(), row["id"]),
            )
            await db.commit()
            return {
                "id": row["id"],
                "username": row["username"],
                "display_name": row["display_name"],
                "email": row["email"],
                "avatar_url": row["avatar_url"],
            }
    except Exception as e:
        logger.error("user_service: authenticate failed | %s", e)
        return None


async def get_user_by_id(user_id: str) -> dict | None:
    """按 ID 查询用户信息（不含密码）。"""
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, username, display_name, email, avatar_url, created_at, last_seen_at FROM users WHERE id = ?",
                (user_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return dict(row)
    except Exception as e:
        logger.error("user_service: get_user_by_id failed | %s", e)
        return None


async def get_user_by_username(username: str) -> dict | None:
    """按用户名查询用户信息（不含密码）。"""
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, username, display_name, email, avatar_url, created_at, last_seen_at FROM users WHERE username = ?",
                (username,),
            )
            row = await cursor.fetchone()
            return dict(row) if row else None
    except Exception as e:
        logger.error("user_service: get_user_by_username failed | %s", e)
        return None


async def list_users(limit: int = 50, offset: int = 0) -> list[dict]:
    """列出所有用户（管理界面用）。"""
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, username, display_name, email, avatar_url, created_at, last_seen_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error("user_service: list_users failed | %s", e)
        return []
