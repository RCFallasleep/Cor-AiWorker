"""本地服务安全模型（docs/ARCHITECTURE.md 4.7，ADR-008）。

本地服务最大的威胁是「浏览器里打开的任意网页」，四层防护：
1. 只监听 127.0.0.1                       —— 由启动命令保证（cli.serve）
2. CORS 只放行明确配置的来源               —— CORSMiddleware
3. Host 头只接受 127.0.0.1 / localhost    —— 防 DNS 重绑定
4. 每次启动生成随机令牌，API 请求必须携带   —— require_token
"""

from __future__ import annotations

import secrets

from fastapi import FastAPI, Request
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .errors import ApiError

ALLOWED_HOSTS = ("127.0.0.1", "localhost")


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def install_security(app: FastAPI, *, allowed_origins: list[str]) -> None:
    # DNS 重绑定：恶意域名解析到 127.0.0.1 后，浏览器会把它当作同源，
    # 但请求的 Host 头仍是那个域名——只接受本机地址即可挡住
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(ALLOWED_HOSTS))
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
        )


async def require_token(request: Request) -> None:
    """校验 Authorization: Bearer <令牌>，使用常数时间比较，避免按耗时逐字符猜测。"""
    expected: str = request.app.state.token
    scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(
        supplied.encode(), expected.encode()
    ):
        raise ApiError(401, "unauthorized", "缺少或错误的访问令牌")
