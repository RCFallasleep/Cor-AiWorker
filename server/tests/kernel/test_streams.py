from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from cor_aiworker.kernel.streams import StreamIdleTimeoutError, with_idle_timeout


async def source(delays: list[float]) -> AsyncIterator[int]:
    for i, delay in enumerate(delays):
        await asyncio.sleep(delay)
        yield i


async def test_passes_items_through() -> None:
    items = [i async for i in with_idle_timeout(source([0, 0, 0]), 1)]
    assert items == [0, 1, 2]


async def test_raises_when_stream_stalls() -> None:
    received: list[int] = []
    with pytest.raises(StreamIdleTimeoutError):
        async for i in with_idle_timeout(source([0, 0.5]), 0.05):
            received.append(i)
    assert received == [0]


async def test_timeout_is_per_item_not_total() -> None:
    # 总耗时超过阈值，但每个间隔都在阈值内，不应超时
    items = [i async for i in with_idle_timeout(source([0.03] * 5), 0.1)]
    assert len(items) == 5


async def test_source_timeout_error_is_not_misreported() -> None:
    async def failing() -> AsyncIterator[int]:
        yield 1
        raise TimeoutError("SDK 自身的超时")

    with pytest.raises(TimeoutError) as excinfo:
        async for _ in with_idle_timeout(failing(), 5):
            pass
    assert not isinstance(excinfo.value, StreamIdleTimeoutError)
