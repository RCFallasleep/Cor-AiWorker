from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.core.cors import setup_cors

# ── 日志配置（必须在其他模块导入前完成，确保工具注册日志可见）────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

from app.api.v1 import agent as agent_router  # noqa: E402
from app.api.v1 import chat as chat_router    # noqa: E402
from app.api.v1 import logs as logs_router    # noqa: E402
from app.services import log_store            # noqa: E402

# 导入 tools 模块，触发工具注册到全局 tool_registry
import app.tools.search  # noqa: F401, E402


# ── 应用生命周期 ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期钩子。"""
    # 启动：初始化 SQLite 日志数据库
    await log_store.init_db()
    logger.info("log_store initialized")
    yield
    # 关闭：无需额外清理


# ── 应用初始化 ────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Cor-AiWorker 后端服务，提供 Agent 编排与 LLM 流式调用能力。",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS
setup_cors(app)

# 路由注册
app.include_router(chat_router.router, prefix="/v1")
app.include_router(agent_router.router, prefix="/v1")
app.include_router(logs_router.router, prefix="/v1")


# ── 健康检查 ──────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


logger.info("app started | debug=%s origins=%s", settings.debug, settings.allowed_origins)
