"""跨目录共用的测试辅助。"""

from __future__ import annotations

from keyring.errors import PasswordDeleteError


class MemoryKeyBackend:
    """内存版钥匙串，测试时代替系统钥匙串。"""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.items.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.items[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if (service, username) not in self.items:
            raise PasswordDeleteError("not found")
        del self.items[(service, username)]
