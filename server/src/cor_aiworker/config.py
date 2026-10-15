"""本地服务配置。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "cor-aiworker"
DATA_DIR_ENV = "COR_AIWORKER_DATA_DIR"


@dataclass(frozen=True)
class Settings:
    data_dir: Path

    @property
    def db_path(self) -> Path:
        return self.data_dir / "cor-aiworker.db"

    @classmethod
    def load(cls) -> Settings:
        """数据目录默认为系统应用数据目录（macOS：~/Library/Application Support/cor-aiworker），
        可用环境变量 COR_AIWORKER_DATA_DIR 覆盖（开发与测试用）。"""
        override = os.environ.get(DATA_DIR_ENV)
        if override:
            return cls(data_dir=Path(override).expanduser())
        return cls(data_dir=Path(user_data_dir(APP_NAME, appauthor=False)))

    def ensure_dirs(self) -> None:
        # 目录里有对话记录，只允许当前用户访问
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
