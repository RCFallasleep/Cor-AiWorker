"""会话管理：创建时校验并绑定 Provider 与模型（ADR-002）。"""

from __future__ import annotations

from ..kernel.providers.factory import PRESETS
from ..storage.sessions import SessionRecord, SessionStore
from .runs import RunManager, SessionBusyError


class UnknownProviderError(ValueError):
    pass


class SessionService:
    def __init__(self, store: SessionStore, runs: RunManager) -> None:
        self._store = store
        self._runs = runs

    async def create(
        self, provider: str, *, model: str | None = None, title: str = ""
    ) -> SessionRecord:
        preset = PRESETS.get(provider)
        if preset is None:
            raise UnknownProviderError(
                f"未知的模型提供方：{provider}（可选：{', '.join(PRESETS)}）"
            )
        return await self._store.create(
            provider=provider, model=model or preset.default_model, title=title
        )

    async def get(self, session_id: str) -> SessionRecord | None:
        return await self._store.get(session_id)

    async def recent(self, limit: int = 50) -> list[SessionRecord]:
        return await self._store.recent(limit)

    async def rename(self, session_id: str, title: str) -> bool:
        return await self._store.rename(session_id, title)

    async def delete(self, session_id: str) -> bool:
        if self._runs.active_run(session_id) is not None:
            raise SessionBusyError("会话正在运行中，请先取消运行再删除")
        return await self._store.delete(session_id)
