"""流式输出工具函数。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable, AsyncIterator


class StreamIdleTimeoutError(TimeoutError):
    def __init__(self, seconds: float) -> None:
        super().__init__(f"模型流式输出超过 {seconds:g} 秒没有新数据，已判定为卡死")
        self.seconds = seconds


async def with_idle_timeout[T](source: AsyncIterable[T], seconds: float) -> AsyncIterator[T]:
    """连续 seconds 秒没有新数据即抛出 StreamIdleTimeoutError。

    SDK 的请求超时只覆盖建立连接与首包；流开始后中途卡住，只能靠空闲超时发现。
    """
    iterator = aiter(source)
    while True:
        deadline = asyncio.timeout(seconds)
        try:
            async with deadline:
                item = await anext(iterator)
        except StopAsyncIteration:
            return
        except TimeoutError as exc:
            # 只有本计时器到期才算空闲超时；数据源自身抛出的 TimeoutError 原样传递
            if deadline.expired():
                raise StreamIdleTimeoutError(seconds) from exc
            raise
        yield item
