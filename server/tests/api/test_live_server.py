"""启动真实的 uvicorn，验证 SSE 能边推边读，并在流进行中完成审批。"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

import httpx
import pytest
import uvicorn

from cor_aiworker.api.app import create_app
from cor_aiworker.app.runtime import Runtime
from cor_aiworker.cli import _Server
from tests.kernel.fakes import FakeProvider, call, turn

from .conftest import TOKEN, ProviderSlot


@pytest.fixture
async def base_url(runtime: Runtime) -> AsyncIterator[str]:
    server = _Server(
        uvicorn.Config(create_app(runtime, token=TOKEN), host="127.0.0.1", port=0, lifespan="off")
    )
    serving = asyncio.create_task(server.serve())
    async with asyncio.timeout(5):
        await server.ready.wait()
    port = server.servers[0].sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    await serving


async def test_sse_streams_live_and_approval_mid_stream(base_url: str, slot: ProviderSlot) -> None:
    slot.provider = FakeProvider([turn(call("fetch")), turn(text="读完了")])
    headers = {"Authorization": f"Bearer {TOKEN}"}
    async with httpx.AsyncClient(base_url=base_url, headers=headers) as client:
        session = (await client.post("/api/sessions", json={"provider": "deepseek"})).json()
        run_id = (
            await client.post(f"/api/sessions/{session['id']}/runs", json={"input": "读网页"})
        ).json()["run_id"]

        seen: list[str] = []
        current_event = ""
        async with asyncio.timeout(10), client.stream("GET", f"/api/runs/{run_id}/events") as resp:
            assert resp.status_code == 200
            async for line in resp.aiter_lines():
                if line.startswith("event: "):
                    current_event = line.removeprefix("event: ")
                    seen.append(current_event)
                elif line.startswith("data: ") and current_event == "approval_requested":
                    # 流还开着的时候，用另一个请求完成审批
                    approval_id = json.loads(line.removeprefix("data: "))["approval_id"]
                    answer = await client.post(
                        f"/api/runs/{run_id}/approvals/{approval_id}", json={"approved": True}
                    )
                    assert answer.status_code == 204

    assert seen[:3] == ["run_started", "turn_finished", "tool_call"]
    assert "approval_resolved" in seen
    assert seen[-1] == "run_finished"
