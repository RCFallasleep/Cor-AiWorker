"""单实例锁：同一数据目录同时只允许一个本地服务进程（ADR-006）。

运行状态（进行中的运行、审批等待）只存在于进程内存中；若两个进程共用同一个数据库，
后启动的进程会在「崩溃恢复」时把前一个进程正在进行的运行误标为已取消。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


class InstanceLockedError(RuntimeError):
    pass


class InstanceLock:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._fd: int | None = None

    def acquire(self) -> None:
        fd = os.open(self._path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            _lock(fd)
        except OSError as exc:
            os.close(fd)
            raise InstanceLockedError(
                f"另一个 Cor-AiWorker 进程正在使用数据目录 {self._path.parent}"
            ) from exc
        self._fd = fd

    def release(self) -> None:
        if self._fd is not None:
            # 关闭文件描述符即释放锁；进程异常退出时操作系统也会自动释放
            os.close(self._fd)
            self._fd = None


if sys.platform == "win32":
    import msvcrt

    def _lock(fd: int) -> None:
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)

else:
    import fcntl

    def _lock(fd: int) -> None:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
