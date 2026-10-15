from __future__ import annotations

import asyncio
from typing import Any

import httpx

from cor_aiworker.app.providers import MissingApiKeyError
from cor_aiworker.app.runtime import Runtime
from tests.kernel.fakes import FakeProvider, call, turn

from .conftest import ProviderSlot, parse_sse


async def new_session(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    response = await client.post("/api/sessions", json={"provider": "deepseek", **body})
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


async def start(client: httpx.AsyncClient, session_id: str, text: str = "你好") -> httpx.Response:
    return await client.post(f"/api/sessions/{session_id}/runs", json={"input": text})


async def events(client: httpx.AsyncClient, run_id: str, **headers: str) -> list[dict[str, Any]]:
    async with asyncio.timeout(5):
        response = await client.get(f"/api/runs/{run_id}/events", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return parse_sse(response.text)


async def wait_for_approval(runtime: Runtime, run_id: str) -> str:
    async with asyncio.timeout(5):
        async for event in runtime.runs.subscribe(run_id):
            if event.type == "approval_requested":
                approval_id: str = event.payload["approval_id"]
                return approval_id
    raise AssertionError("没有出现审批请求")


# ── 模型提供方 ──────────────────────────────────────────────────────────────


async def test_api_key_lifecycle_never_returns_key(client: httpx.AsyncClient) -> None:
    def deepseek(providers: list[dict[str, Any]]) -> dict[str, Any]:
        return next(p for p in providers if p["name"] == "deepseek")

    assert not deepseek((await client.get("/api/providers")).json())["has_key"]
    put = await client.put("/api/providers/deepseek/key", json={"key": "sk-secret-123"})
    assert put.status_code == 204

    listing = await client.get("/api/providers")
    assert deepseek(listing.json())["has_key"]
    assert "sk-secret-123" not in listing.text

    assert (await client.delete("/api/providers/deepseek/key")).status_code == 204
    assert not deepseek((await client.get("/api/providers")).json())["has_key"]
    unknown = await client.put("/api/providers/nope/key", json={"key": "x"})
    assert unknown.json()["error"]["code"] == "unknown_provider"


# ── 会话 ──────────────────────────────────────────────────────────────────


async def test_session_crud(client: httpx.AsyncClient) -> None:
    session = await new_session(client)
    assert session["model"] == "deepseek-v4-pro"

    detail = (await client.get(f"/api/sessions/{session['id']}")).json()
    assert detail["active_run_id"] is None
    renamed = await client.patch(f"/api/sessions/{session['id']}", json={"title": "新标题"})
    assert renamed.json()["title"] == "新标题"
    assert [s["id"] for s in (await client.get("/api/sessions")).json()] == [session["id"]]

    assert (await client.delete(f"/api/sessions/{session['id']}")).status_code == 204
    missing = await client.get(f"/api/sessions/{session['id']}")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "session_not_found")


async def test_unknown_provider_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/sessions", json={"provider": "nope"})
    assert (response.status_code, response.json()["error"]["code"]) == (400, "unknown_provider")


# ── 运行与事件流 ────────────────────────────────────────────────────────────


async def test_run_streams_events_and_sets_title(
    client: httpx.AsyncClient, slot: ProviderSlot
) -> None:
    slot.provider = FakeProvider([turn(text="你好呀")])
    session = await new_session(client)

    question = "长问题" * 20
    accepted = await start(client, session["id"], question)
    assert accepted.status_code == 202
    run_id = accepted.json()["run_id"]
    stream = await events(client, run_id)

    assert [e["event"] for e in stream] == [
        "run_started",
        "text_delta",
        "turn_finished",
        "run_finished",
    ]
    assert [e["id"] for e in stream] == [1, 2, 3, 4]
    assert stream[1]["data"]["text"] == "你好呀"

    run = (await client.get(f"/api/runs/{run_id}")).json()
    assert run["status"] == "finished"
    assert [r["id"] for r in (await client.get(f"/api/sessions/{session['id']}/runs")).json()] == [
        run_id
    ]
    title = (await client.get(f"/api/sessions/{session['id']}")).json()["title"]
    assert title == question[:30]  # 没有标题的会话，自动取第一条消息的前 30 个字符


async def test_events_resume_from_last_event_id(
    client: httpx.AsyncClient, slot: ProviderSlot
) -> None:
    slot.provider = FakeProvider([turn(text="你好")])
    session = await new_session(client)
    run_id = (await start(client, session["id"])).json()["run_id"]
    full = await events(client, run_id)

    assert await events(client, run_id, **{"Last-Event-ID": "2"}) == full[2:]
    resumed = await client.get(f"/api/runs/{run_id}/events", params={"after": 3})
    assert parse_sse(resumed.text) == full[3:]


async def test_events_for_unknown_run_is_json_404(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/runs/missing/events")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "run_not_found"


async def test_missing_api_key(client: httpx.AsyncClient, slot: ProviderSlot) -> None:
    slot.error = MissingApiKeyError("deepseek")
    session = await new_session(client)
    response = await start(client, session["id"])
    assert (response.status_code, response.json()["error"]["code"]) == (400, "missing_api_key")


async def test_approval_busy_and_cancel(
    client: httpx.AsyncClient, runtime: Runtime, slot: ProviderSlot
) -> None:
    slot.provider = FakeProvider([turn(call("fetch")), turn(text="完成")])
    session = await new_session(client)
    run_id = (await start(client, session["id"])).json()["run_id"]
    await wait_for_approval(runtime, run_id)

    busy = await start(client, session["id"], "再来一个")
    assert (busy.status_code, busy.json()["error"]["code"]) == (409, "session_busy")
    detail = (await client.get(f"/api/sessions/{session['id']}")).json()
    assert detail["active_run_id"] == run_id

    wrong = await client.post(f"/api/runs/{run_id}/approvals/nope", json={"approved": True})
    assert wrong.json()["error"]["code"] == "approval_not_found"

    assert (await client.post(f"/api/runs/{run_id}/cancel")).status_code == 204
    again = await client.post(f"/api/runs/{run_id}/cancel")
    assert (again.status_code, again.json()["error"]["code"]) == (409, "run_not_active")
    assert (await client.get(f"/api/runs/{run_id}")).json()["status"] == "cancelled"


async def test_approve_over_http(
    client: httpx.AsyncClient, runtime: Runtime, slot: ProviderSlot
) -> None:
    slot.provider = FakeProvider([turn(call("fetch")), turn(text="完成")])
    session = await new_session(client)
    run_id = (await start(client, session["id"])).json()["run_id"]
    approval_id = await wait_for_approval(runtime, run_id)

    answer = await client.post(
        f"/api/runs/{run_id}/approvals/{approval_id}", json={"approved": True}
    )
    assert answer.status_code == 204
    stream = await events(client, run_id)
    [result] = [e for e in stream if e["event"] == "tool_result"]
    assert not result["data"]["is_error"]
    assert result["data"]["untrusted"]


# ── 工具与权限 ──────────────────────────────────────────────────────────────


async def test_tool_policies(client: httpx.AsyncClient) -> None:
    tools = {t["name"]: t for t in (await client.get("/api/tools")).json()}
    assert tools["fetch"]["risk"] == "network"
    assert tools["get_current_time"]["policy"] is None

    assert (
        await client.put("/api/tools/fetch/policy", json={"decision": "allow"})
    ).status_code == 204
    tools = {t["name"]: t for t in (await client.get("/api/tools")).json()}
    assert tools["fetch"]["policy"] == "allow"
    assert (await client.delete("/api/tools/fetch/policy")).status_code == 204

    invalid = await client.put("/api/tools/fetch/policy", json={"decision": "maybe"})
    assert invalid.status_code == 422
    unknown = await client.put("/api/tools/nope/policy", json={"decision": "allow"})
    assert unknown.json()["error"]["code"] == "tool_not_found"
