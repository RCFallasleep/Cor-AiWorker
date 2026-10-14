"""API Key 存取：保存在系统钥匙串（macOS Keychain 等），不落盘到项目、不进代码。"""

from __future__ import annotations

import keyring

SERVICE = "cor-aiworker"


def save_key(provider: str, key: str) -> None:
    keyring.set_password(SERVICE, provider, key)


def load_key(provider: str) -> str | None:
    return keyring.get_password(SERVICE, provider)
