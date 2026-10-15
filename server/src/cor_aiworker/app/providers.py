"""按会话创建 Provider：Key 从钥匙串读取，模型取会话创建时绑定的模型（ADR-002）。"""

from __future__ import annotations

from collections.abc import Callable

from ..kernel.providers.base import Provider
from ..kernel.providers.factory import create_provider
from ..keystore import Keystore
from ..storage.sessions import SessionRecord

ProviderFactory = Callable[[SessionRecord], Provider]


class MissingApiKeyError(LookupError):
    def __init__(self, provider: str) -> None:
        super().__init__(f"尚未配置 {provider} 的 API Key")
        self.provider = provider


def keystore_provider_factory(keystore: Keystore) -> ProviderFactory:
    def factory(session: SessionRecord) -> Provider:
        api_key = keystore.get(session.provider)
        if not api_key:
            raise MissingApiKeyError(session.provider)
        return create_provider(session.provider, api_key=api_key, model=session.model)

    return factory
