from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest

from cor_aiworker.api.app import create_app
from cor_aiworker.app.runtime import Runtime
from cor_aiworker.config import Settings
from cor_aiworker.kernel.providers.base import Provider
from cor_aiworker.kernel.tools.registry import ToolOutput
from cor_aiworker.kernel.types import JSON, ToolSpec
from cor_aiworker.keystore import Keystore
from cor_aiworker.storage.sessions import SessionRecord
from tests.helpers import MemoryKeyBackend
from tests.kernel.fakes import FakeProvider

TOKEN = "test-token"


@dataclass
class ProviderSlot:
    """测试中随时替换下一次运行使用的 Provider。"""

    provider: Provider = field(default_factory=lambda: FakeProvider([]))
    error: Exception | None = None

    def __call__(self, session: SessionRecord) -> Provider:
        if self.error is not None:
            raise self.error
        return self.provider


async def fake_fetch(arguments: JSON) -> ToolOutput:
    return ToolOutput("网页内容")


@pytest.fixture
def slot() -> ProviderSlot:
    return ProviderSlot()


@pytest.fixture
async def runtime(tmp_path: Path, slot: ProviderSlot) -> AsyncIterator[Runtime]:
    async with Runtime.open(
        Settings(tmp_path), keystore=Keystore(MemoryKeyBackend()), provider_factory=slot
    ) as rt:
        rt.tools.register(
            ToolSpec("fetch", "抓取网页", {"type": "object"}),
            fake_fetch,
            risk="network",
            untrusted=True,
        )
        yield rt


@pytest.fixture
async def client(runtime: Runtime) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(runtime, token=TOKEN)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://127.0.0.1",
        headers={"Authorization": f"Bearer {TOKEN}"},
    ) as c:
        yield c


def parse_sse(text: str) -> list[dict[str, Any]]:
    """把 SSE 文本解析成 [{"id": 1, "event": "...", "data": {...}}]，忽略心跳注释。"""
    events: list[dict[str, Any]] = []
    for block in text.split("\n\n"):
        fields: dict[str, str] = {}
        for line in block.splitlines():
            if not line or line.startswith(":"):
                continue
            key, _, value = line.partition(":")
            fields[key] = value.removeprefix(" ")
        if "data" in fields:
            events.append(
                {
                    "id": int(fields["id"]),
                    "event": fields["event"],
                    "data": json.loads(fields["data"]),
                }
            )
    return events
