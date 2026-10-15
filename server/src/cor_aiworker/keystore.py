"""密钥存取：只存系统钥匙串（ADR-007），不进数据库、日志与前端。

条目命名：
- 模型 API Key：Provider 名（如 "anthropic"、"deepseek"）
- MCP 服务的密钥类环境变量："mcp:{服务名}:{变量名}"
"""

from __future__ import annotations

import contextlib
from typing import Protocol

import keyring
from keyring.errors import PasswordDeleteError

SERVICE = "cor-aiworker"


class KeyBackend(Protocol):
    def get_password(self, service: str, username: str) -> str | None: ...
    def set_password(self, service: str, username: str, password: str) -> None: ...
    def delete_password(self, service: str, username: str) -> None: ...


def mcp_secret_name(server: str, variable: str) -> str:
    return f"mcp:{server}:{variable}"


class Keystore:
    def __init__(self, backend: KeyBackend | None = None, service: str = SERVICE) -> None:
        self._backend: KeyBackend = backend or keyring.get_keyring()
        self._service = service

    def get(self, name: str) -> str | None:
        return self._backend.get_password(self._service, name)

    def has(self, name: str) -> bool:
        return bool(self.get(name))

    def set(self, name: str, secret: str) -> None:
        secret = secret.strip()
        if not secret:
            raise ValueError("密钥不能为空")
        self._backend.set_password(self._service, name, secret)

    def delete(self, name: str) -> None:
        # 本来就不存在时，keyring 会抛 PasswordDeleteError，视为删除成功
        with contextlib.suppress(PasswordDeleteError):
            self._backend.delete_password(self._service, name)
