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

from app.api.v1 import agent as agent_router          # noqa: E402
from app.api.v1 import chat as chat_router            # noqa: E402
from app.api.v1 import logs as logs_router            # noqa: E402
from app.api.v1 import livebench as livebench_router  # noqa: E402
from app.api.v1 import organize as organize_router              # noqa: E402
from app.api.v1 import deduction as deduction_router            # noqa: E402
from app.api.v1 import graph_deduction as graph_deduction_router  # noqa: E402
from app.api.v1 import discussion as discussion_router            # noqa: E402
from app.api.v1 import skills as skills_router                    # noqa: E402
from app.services import log_store                  # noqa: E402
from app.services import skill_store                # noqa: E402

# 导入 tools 模块，触发工具注册到全局 tool_registry
import app.tools.search  # noqa: F401, E402
from app.tools.skill_runner import load_enabled_skills  # noqa: E402


# ── 应用生命周期 ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期钩子。"""
    # 启动：初始化 SQLite 日志数据库
    await log_store.init_db()
    logger.info("log_store initialized")
    # 启动：初始化 Skill 数据库并种入内置 Skill
    skill_store.seed_builtin_skills()
    logger.info("skill_store initialized")
    # 加载用户自建 Skill 到 tool_registry
    n = load_enabled_skills()
    logger.info("custom skills loaded | count=%d", n)
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
app.include_router(livebench_router.router, prefix="/v1")
app.include_router(organize_router.router, prefix="/v1")
app.include_router(deduction_router.router, prefix="/v1")
app.include_router(graph_deduction_router.router, prefix="/v1")
app.include_router(discussion_router.router, prefix="/v1")
app.include_router(skills_router.router, prefix="/v1")


# ── 健康检查 ──────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


logger.info("app started | debug=%s origins=%s", settings.debug, settings.allowed_origins)
