"""本地服务安全模型（ADR-008）。"""

from __future__ import annotations

import httpx

from cor_aiworker.api.app import create_app
from cor_aiworker.app.runtime import Runtime

from .conftest import TOKEN


def bare_client(runtime: Runtime, allowed_origins: list[str] | None = None) -> httpx.AsyncClient:
    app = create_app(runtime, token=TOKEN, allowed_origins=allowed_origins)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1")


async def test_health_needs_no_token(runtime: Runtime) -> None:
    async with bare_client(runtime) as c:
        response = await c.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_missing_or_wrong_token_is_rejected(runtime: Runtime) -> None:
    async with bare_client(runtime) as c:
        for headers in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}):
            response = await c.get("/api/sessions", headers=headers)
            assert response.status_code == 401
            assert response.json()["error"]["code"] == "unauthorized"
        ok = await c.get("/api/sessions", headers={"Authorization": f"bearer {TOKEN}"})
    assert ok.status_code == 200


async def test_foreign_host_header_is_rejected(runtime: Runtime) -> None:
    """DNS 重绑定：恶意域名解析到 127.0.0.1 时，Host 头仍是该域名。"""
    async with bare_client(runtime) as c:
        response = await c.get(
            "/api/sessions",
            headers={"Host": "evil.example", "Authorization": f"Bearer {TOKEN}"},
        )
    assert response.status_code == 400


async def test_cross_origin_requests_get_no_cors_grant(runtime: Runtime) -> None:
    async with bare_client(runtime) as c:
        preflight = await c.options(
            "/api/sessions",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
        )
        simple = await c.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in preflight.headers
    assert "access-control-allow-origin" not in simple.headers


async def test_configured_origin_is_allowed(runtime: Runtime) -> None:
    origin = "http://localhost:3000"
    async with bare_client(runtime, allowed_origins=[origin]) as c:
        preflight = await c.options(
            "/api/sessions",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        evil = await c.options(
            "/api/sessions",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
        )
    assert preflight.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-origin" not in evil.headers


async def test_validation_errors_do_not_echo_secrets(client: httpx.AsyncClient) -> None:
    secret = "sk-very-secret-" + "x" * 5000  # 超出长度限制，触发校验失败
    response = await client.put("/api/providers/deepseek/key", json={"key": secret})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert "sk-very-secret" not in response.text
