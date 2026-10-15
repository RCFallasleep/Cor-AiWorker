"""API 路由：只做参数校验与格式转换，业务都在应用层。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent

from ..app.runtime import Runtime
from ..kernel.providers.factory import PRESETS
from .errors import ApiError
from .schemas import (
    ApiKeyIn,
    ApprovalIn,
    ProviderOut,
    RunAccepted,
    RunCreate,
    RunOut,
    SessionCreate,
    SessionDetail,
    SessionOut,
    SessionUpdate,
    ToolOut,
    ToolPolicyIn,
)
from .security import require_token

AUTO_TITLE_LENGTH = 30


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime = request.app.state.runtime
    return runtime


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]

public = APIRouter(prefix="/api")
router = APIRouter(prefix="/api", dependencies=[Depends(require_token)])


@public.get("/health")
async def health() -> dict[str, str]:
    """唯一不需要令牌的接口，只用于判断服务是否在线，不暴露任何信息。"""
    return {"status": "ok"}


# ── 模型提供方与 API Key ─────────────────────────────────────────────────────


def _known_provider(name: str) -> str:
    if name not in PRESETS:
        raise ApiError(404, "unknown_provider", f"未知的模型提供方：{name}")
    return name


@router.get("/providers")
async def list_providers(runtime: RuntimeDep) -> list[ProviderOut]:
    # 钥匙串调用是同步的，第一次访问时 macOS 可能弹窗等待用户授权，放到线程里避免阻塞事件循环
    configured = await asyncio.to_thread(lambda: {n: runtime.keystore.has(n) for n in PRESETS})
    return [
        ProviderOut(
            name=name,
            protocol=preset.protocol,
            default_model=preset.default_model,
            has_key=configured[name],
        )
        for name, preset in PRESETS.items()
    ]


@router.put("/providers/{name}/key", status_code=204)
async def set_api_key(name: str, body: ApiKeyIn, runtime: RuntimeDep) -> Response:
    await asyncio.to_thread(runtime.keystore.set, _known_provider(name), body.key)
    return Response(status_code=204)


@router.delete("/providers/{name}/key", status_code=204)
async def delete_api_key(name: str, runtime: RuntimeDep) -> Response:
    await asyncio.to_thread(runtime.keystore.delete, _known_provider(name))
    return Response(status_code=204)


# ── 会话 ──────────────────────────────────────────────────────────────────


async def _session_or_404(runtime: Runtime, session_id: str) -> SessionOut:
    record = await runtime.sessions.get(session_id)
    if record is None:
        raise ApiError(404, "session_not_found", "会话不存在")
    return SessionOut.model_validate(record)


@router.post("/sessions", status_code=201)
async def create_session(body: SessionCreate, runtime: RuntimeDep) -> SessionOut:
    record = await runtime.sessions.create(body.provider, model=body.model, title=body.title)
    return SessionOut.model_validate(record)


@router.get("/sessions")
async def list_sessions(
    runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[SessionOut]:
    return [SessionOut.model_validate(r) for r in await runtime.sessions.recent(limit)]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, runtime: RuntimeDep) -> SessionDetail:
    session = await _session_or_404(runtime, session_id)
    return SessionDetail(**session.model_dump(), active_run_id=runtime.runs.active_run(session_id))


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, body: SessionUpdate, runtime: RuntimeDep) -> SessionOut:
    if not await runtime.sessions.rename(session_id, body.title):
        raise ApiError(404, "session_not_found", "会话不存在")
    return await _session_or_404(runtime, session_id)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, runtime: RuntimeDep) -> Response:
    if not await runtime.sessions.delete(session_id):
        raise ApiError(404, "session_not_found", "会话不存在")
    return Response(status_code=204)


# ── 运行 ──────────────────────────────────────────────────────────────────


@router.get("/sessions/{session_id}/runs")
async def list_runs(session_id: str, runtime: RuntimeDep) -> list[RunOut]:
    await _session_or_404(runtime, session_id)
    return [RunOut.model_validate(r) for r in await runtime.run_store.for_session(session_id)]


@router.post("/sessions/{session_id}/runs", status_code=202)
async def start_run(session_id: str, body: RunCreate, runtime: RuntimeDep) -> RunAccepted:
    """立即返回运行 id；运行在后台进行，通过 GET /api/runs/{id}/events 订阅进度。"""
    session = await _session_or_404(runtime, session_id)
    run_id = await runtime.runs.start(session_id, body.input)
    if not session.title:
        await runtime.sessions.rename(session_id, body.input.strip()[:AUTO_TITLE_LENGTH])
    return RunAccepted(run_id=run_id)


async def _existing_run(run_id: str, runtime: RuntimeDep) -> str:
    # 作为依赖在流开始前执行：运行不存在时能正常返回 404，而不是一个中途出错的事件流
    if await runtime.run_store.get(run_id) is None:
        raise ApiError(404, "run_not_found", "运行不存在")
    return run_id


@router.get("/runs/{run_id}")
async def get_run(run_id: str, runtime: RuntimeDep) -> RunOut:
    record = await runtime.run_store.get(run_id)
    if record is None:
        raise ApiError(404, "run_not_found", "运行不存在")
    return RunOut.model_validate(record)


@router.get("/runs/{run_id}/events", response_class=EventSourceResponse)
async def run_events(
    run_id: Annotated[str, Depends(_existing_run)],
    runtime: RuntimeDep,
    after: Annotated[int, Query(ge=0)] = 0,
    last_event_id: Annotated[str | None, Header()] = None,
) -> AsyncIterator[ServerSentEvent]:
    """SSE 事件流，直到运行结束。断线重连时带上 Last-Event-ID 头（或 after 参数），
    只补发错过的事件（ADR-004）。"""
    if last_event_id and last_event_id.isdigit():
        after = max(after, int(last_event_id))
    async for event in runtime.runs.subscribe(run_id, after_seq=after):
        yield ServerSentEvent(data=event.payload, event=event.type, id=str(event.seq))


@router.post("/runs/{run_id}/approvals/{approval_id}", status_code=204)
async def answer_approval(
    run_id: str, approval_id: str, body: ApprovalIn, runtime: RuntimeDep
) -> Response:
    if not runtime.runs.resolve_approval(run_id, approval_id, body.approved):
        raise ApiError(404, "approval_not_found", "审批不存在或已答复")
    return Response(status_code=204)


@router.post("/runs/{run_id}/cancel", status_code=204)
async def cancel_run(run_id: str, runtime: RuntimeDep) -> Response:
    if not await runtime.runs.cancel(run_id):
        raise ApiError(409, "run_not_active", "运行已结束或不存在")
    return Response(status_code=204)


# ── 工具与权限 ──────────────────────────────────────────────────────────────


@router.get("/tools")
async def list_tools(runtime: RuntimeDep) -> list[ToolOut]:
    policies = await runtime.settings_store.tool_policies()
    return [
        ToolOut(
            name=spec.name,
            description=spec.description,
            risk=runtime.tools.risk(spec.name),
            untrusted=runtime.tools.is_untrusted(spec.name),
            policy=policies.get(spec.name),
        )
        for spec in runtime.tools.specs()
    ]


def _known_tool(name: str, runtime: Runtime) -> str:
    if not runtime.tools.has(name):
        raise ApiError(404, "tool_not_found", f"工具不存在：{name}")
    return name


@router.put("/tools/{name}/policy", status_code=204)
async def set_tool_policy(name: str, body: ToolPolicyIn, runtime: RuntimeDep) -> Response:
    await runtime.settings_store.set_tool_policy(_known_tool(name, runtime), body.decision)
    return Response(status_code=204)


@router.delete("/tools/{name}/policy", status_code=204)
async def clear_tool_policy(name: str, runtime: RuntimeDep) -> Response:
    await runtime.settings_store.clear_tool_policy(_known_tool(name, runtime))
    return Response(status_code=204)
