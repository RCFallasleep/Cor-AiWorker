from __future__ import annotations

from pathlib import Path

import pytest

from cor_aiworker.app.providers import MissingApiKeyError, keystore_provider_factory
from cor_aiworker.app.runtime import Runtime
from cor_aiworker.app.sessions import UnknownProviderError
from cor_aiworker.config import Settings
from cor_aiworker.keystore import Keystore
from cor_aiworker.storage.db import Database
from cor_aiworker.storage.runs import RunStore
from cor_aiworker.storage.sessions import SessionRecord, SessionStore
from cor_aiworker.storage.settings import McpServerRecord, SettingsStore
from tests.helpers import MemoryKeyBackend


def make_keystore(**secrets: str) -> Keystore:
    keystore = Keystore(MemoryKeyBackend())
    for name, value in secrets.items():
        keystore.set(name, value)
    return keystore


async def test_open_prepares_everything(tmp_path: Path) -> None:
    settings = Settings(tmp_path / "data")
    async with Runtime.open(settings, keystore=make_keystore()) as runtime:
        assert settings.db_path.exists()
        assert runtime.tools.has("get_current_time")
        assert runtime.recovered_runs == 0
        assert runtime.mcp_errors == {}


async def test_open_recovers_runs_interrupted_by_crash(tmp_path: Path) -> None:
    settings = Settings(tmp_path)
    settings.ensure_dirs()
    db = await Database.open(settings.db_path)
    session = await SessionStore(db).create(provider="deepseek", model="m")
    run = await RunStore(db).start(session.id, "进程退出前没跑完")
    await db.close()

    async with Runtime.open(settings, keystore=make_keystore()) as runtime:
        assert runtime.recovered_runs == 1
        record = await runtime.run_store.get(run.id)
        assert record is not None and record.status == "cancelled"


async def test_broken_mcp_servers_do_not_block_startup(tmp_path: Path) -> None:
    settings = Settings(tmp_path)
    settings.ensure_dirs()
    db = await Database.open(settings.db_path)
    store = SettingsStore(db)
    await store.save_mcp_server(McpServerRecord("missing-cmd", "definitely-not-a-command-xyz"))
    await store.save_mcp_server(
        McpServerRecord("needs-key", "uvx", ["some-server"], {"API_KEY": "mcp:needs-key:API_KEY"})
    )
    await store.save_mcp_server(McpServerRecord("off", "whatever", enabled=False))
    await db.close()

    async with Runtime.open(settings, keystore=make_keystore()) as runtime:
        assert set(runtime.mcp_errors) == {"missing-cmd", "needs-key"}
        assert "钥匙串中缺少" in runtime.mcp_errors["needs-key"]
        assert runtime.tools.has("get_current_time")


async def test_session_service_binds_default_model(tmp_path: Path) -> None:
    async with Runtime.open(Settings(tmp_path), keystore=make_keystore()) as runtime:
        session = await runtime.sessions.create("deepseek")
        assert session.model == "deepseek-v4-pro"
        custom = await runtime.sessions.create("anthropic", model="claude-sonnet-5-5")
        assert custom.model == "claude-sonnet-5-5"
        with pytest.raises(UnknownProviderError):
            await runtime.sessions.create("nope")


def test_keystore_provider_factory() -> None:
    session = SessionRecord("s", "", "deepseek", "deepseek-v4-flash", "t", "t")
    with pytest.raises(MissingApiKeyError):
        keystore_provider_factory(make_keystore())(session)
    provider = keystore_provider_factory(make_keystore(deepseek="sk-test"))(session)
    assert (provider.name, provider.model) == ("deepseek", "deepseek-v4-flash")
