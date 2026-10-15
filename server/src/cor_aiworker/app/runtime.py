"""组装入口：按顺序打开数据库、恢复中断的运行、注册工具、连接 MCP、创建运行管理器；
退出时按相反顺序收尾。CLI、HTTP 服务、评测脚本都通过它获得一个完整可用的本地服务。"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast, get_args

from ..config import Settings
from ..kernel.loop import LoopConfig
from ..kernel.tools.builtin import register_builtin_tools
from ..kernel.tools.mcp import McpConnections, McpServerConfig
from ..kernel.tools.registry import ToolRegistry
from ..kernel.types import Risk
from ..keystore import Keystore
from ..storage.db import Database
from ..storage.runs import RunStore
from ..storage.sessions import SessionStore
from ..storage.settings import McpServerRecord, SettingsStore
from .providers import ProviderFactory, keystore_provider_factory
from .runs import RunManager
from .sessions import SessionService

logger = logging.getLogger(__name__)


@dataclass
class Runtime:
    settings: Settings
    db: Database
    keystore: Keystore
    tools: ToolRegistry
    sessions: SessionService
    runs: RunManager
    run_store: RunStore
    settings_store: SettingsStore
    recovered_runs: int = 0
    # MCP 服务连接失败不阻止启动，错误按服务名记录，供界面展示
    mcp_errors: dict[str, str] = field(default_factory=dict)

    @classmethod
    @asynccontextmanager
    async def open(
        cls,
        settings: Settings,
        *,
        keystore: Keystore | None = None,
        provider_factory: ProviderFactory | None = None,
        loop_config: LoopConfig | None = None,
    ) -> AsyncIterator[Runtime]:
        keystore = keystore or Keystore()
        settings.ensure_dirs()
        db = await Database.open(settings.db_path)
        try:
            run_store = RunStore(db)
            recovered = await run_store.recover_interrupted()
            session_store = SessionStore(db)
            settings_store = SettingsStore(db)

            tools = ToolRegistry()
            register_builtin_tools(tools)
            async with McpConnections(tools) as mcp:
                errors = await _connect_mcp_servers(mcp, settings_store, keystore)
                manager = RunManager(
                    sessions=session_store,
                    runs=run_store,
                    settings=settings_store,
                    tools=tools,
                    provider_factory=provider_factory or keystore_provider_factory(keystore),
                    loop_config=loop_config,
                )
                try:
                    yield cls(
                        settings=settings,
                        db=db,
                        keystore=keystore,
                        tools=tools,
                        sessions=SessionService(session_store, manager),
                        runs=manager,
                        run_store=run_store,
                        settings_store=settings_store,
                        recovered_runs=recovered,
                        mcp_errors=errors,
                    )
                finally:
                    # 先停运行（它们可能正在调用 MCP 工具），再关 MCP，最后关数据库
                    await manager.shutdown()
        finally:
            await db.close()


async def _connect_mcp_servers(
    mcp: McpConnections, store: SettingsStore, keystore: Keystore
) -> dict[str, str]:
    errors: dict[str, str] = {}
    for record in await store.mcp_servers(enabled_only=True):
        try:
            config = _to_config(record, keystore)
            names = await mcp.connect(config)
            logger.info("已连接 MCP 服务 %s：%s", record.name, ", ".join(names))
        except Exception as exc:  # 单个服务失败不影响其他服务与整体启动
            errors[record.name] = f"{type(exc).__name__}: {exc}"
            logger.warning("MCP 服务 %s 连接失败：%s", record.name, errors[record.name])
    return errors


def _to_config(record: McpServerRecord, keystore: Keystore) -> McpServerConfig:
    if record.risk not in get_args(Risk):
        raise ValueError(f"无效的风险等级：{record.risk}")
    env: dict[str, str] = {}
    for variable, secret_name in record.env_refs.items():
        value = keystore.get(secret_name)
        if not value:
            raise LookupError(f"钥匙串中缺少 {secret_name}（环境变量 {variable}）")
        env[variable] = value
    return McpServerConfig(
        name=record.name,
        command=record.command,
        args=tuple(record.args),
        env=env or None,
        risk=cast(Risk, record.risk),
        untrusted=record.untrusted,
    )
