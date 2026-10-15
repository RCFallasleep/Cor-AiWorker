"""创建 FastAPI 应用。Runtime 的生命周期由调用方（cli.serve 或测试）管理。"""

from __future__ import annotations

from fastapi import FastAPI

from .. import __version__
from ..app.runtime import Runtime
from .errors import install_error_handlers
from .routes import public, router
from .security import install_security


def create_app(
    runtime: Runtime, *, token: str, allowed_origins: list[str] | None = None
) -> FastAPI:
    app = FastAPI(
        title="Cor-AiWorker 本地服务",
        version=__version__,
        # 接口文档不需要令牌：只描述接口结构、不含任何数据，且同样受本机监听与 Host 校验保护
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.runtime = runtime
    app.state.token = token
    install_security(app, allowed_origins=allowed_origins or [])
    install_error_handlers(app)
    app.include_router(public)
    app.include_router(router)
    return app
