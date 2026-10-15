"""设置：MCP 服务配置与按工具覆盖的权限策略。"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

from .db import Database, dump_json, now


@dataclass(frozen=True)
class McpServerRecord:
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    # 环境变量名 → 钥匙串条目名；值本身不进数据库（ADR-007）
    env_refs: dict[str, str] = field(default_factory=dict)
    risk: str = "network"
    untrusted: bool = True
    enabled: bool = True


def _mcp(row: sqlite3.Row) -> McpServerRecord:
    return McpServerRecord(
        name=row["name"],
        command=row["command"],
        args=json.loads(row["args"]),
        env_refs=json.loads(row["env_refs"]),
        risk=row["risk"],
        untrusted=bool(row["untrusted"]),
        enabled=bool(row["enabled"]),
    )


class SettingsStore:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def save_mcp_server(self, record: McpServerRecord) -> None:
        timestamp = now()
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO mcp_servers"
                " (name, command, args, env_refs, risk, untrusted, enabled, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT (name) DO UPDATE SET command = excluded.command,"
                " args = excluded.args, env_refs = excluded.env_refs, risk = excluded.risk,"
                " untrusted = excluded.untrusted, enabled = excluded.enabled,"
                " updated_at = excluded.updated_at",
                (
                    record.name,
                    record.command,
                    dump_json(record.args),
                    dump_json(record.env_refs),
                    record.risk,
                    int(record.untrusted),
                    int(record.enabled),
                    timestamp,
                    timestamp,
                ),
            )

    async def mcp_servers(self, *, enabled_only: bool = False) -> list[McpServerRecord]:
        sql = "SELECT * FROM mcp_servers"
        if enabled_only:
            sql += " WHERE enabled = 1"
        rows = await self._db.fetchall(sql + " ORDER BY name")
        return [_mcp(r) for r in rows]

    async def delete_mcp_server(self, name: str) -> bool:
        async with self._db.transaction() as conn:
            cursor = await conn.execute("DELETE FROM mcp_servers WHERE name = ?", (name,))
            return cursor.rowcount > 0

    async def set_tool_policy(self, tool_name: str, decision: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO tool_policies (tool_name, decision, updated_at) VALUES (?, ?, ?)"
                " ON CONFLICT (tool_name) DO UPDATE SET decision = excluded.decision,"
                " updated_at = excluded.updated_at",
                (tool_name, decision, now()),
            )

    async def clear_tool_policy(self, tool_name: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute("DELETE FROM tool_policies WHERE tool_name = ?", (tool_name,))

    async def tool_policies(self) -> dict[str, str]:
        rows = await self._db.fetchall("SELECT tool_name, decision FROM tool_policies")
        return {r["tool_name"]: r["decision"] for r in rows}
