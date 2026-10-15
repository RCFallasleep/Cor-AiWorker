from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from cor_aiworker.storage.db import Database


@pytest.fixture
async def db(tmp_path: Path) -> AsyncIterator[Database]:
    database = await Database.open(tmp_path / "test.db")
    yield database
    await database.close()
