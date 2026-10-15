from __future__ import annotations

from pathlib import Path

import pytest

from cor_aiworker.config import DATA_DIR_ENV, Settings
from cor_aiworker.keystore import Keystore, mcp_secret_name
from tests.helpers import MemoryKeyBackend


def test_data_dir_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(DATA_DIR_ENV, str(tmp_path / "data"))
    settings = Settings.load()
    assert settings.db_path == tmp_path / "data" / "cor-aiworker.db"
    settings.ensure_dirs()
    assert (tmp_path / "data").stat().st_mode & 0o077 == 0  # 其他用户无权访问


def test_default_data_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(DATA_DIR_ENV, raising=False)
    assert Settings.load().data_dir.name == "cor-aiworker"


def test_keystore_round_trip() -> None:
    store = Keystore(MemoryKeyBackend())
    assert not store.has("deepseek")
    store.set("deepseek", "  sk-test \n")
    assert store.get("deepseek") == "sk-test"  # 粘贴时带入的空白会被去掉
    store.delete("deepseek")
    store.delete("deepseek")  # 重复删除不报错
    assert store.get("deepseek") is None


def test_keystore_rejects_empty_secret() -> None:
    with pytest.raises(ValueError, match="不能为空"):
        Keystore(MemoryKeyBackend()).set("x", "   ")


def test_mcp_secret_name() -> None:
    assert mcp_secret_name("search", "API_KEY") == "mcp:search:API_KEY"
