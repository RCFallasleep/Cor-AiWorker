from __future__ import annotations

from pathlib import Path

import pytest

from cor_aiworker.app.runtime import Runtime
from cor_aiworker.config import Settings
from cor_aiworker.instance import InstanceLock, InstanceLockedError
from cor_aiworker.keystore import Keystore
from tests.helpers import MemoryKeyBackend


def test_lock_is_exclusive_and_reusable(tmp_path: Path) -> None:
    first, second = InstanceLock(tmp_path / "x.lock"), InstanceLock(tmp_path / "x.lock")
    first.acquire()
    with pytest.raises(InstanceLockedError):
        second.acquire()
    first.release()
    second.acquire()  # 释放后可以再次获取
    second.release()


async def test_second_runtime_on_same_data_dir_is_refused(tmp_path: Path) -> None:
    settings = Settings(tmp_path)
    keystore = Keystore(MemoryKeyBackend())
    async with Runtime.open(settings, keystore=keystore):
        with pytest.raises(InstanceLockedError):
            async with Runtime.open(settings, keystore=keystore):
                pass
    async with Runtime.open(settings, keystore=keystore):  # 第一个关闭后可以正常打开
        pass
