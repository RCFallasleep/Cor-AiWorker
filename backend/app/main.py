from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.cors import setup_cors

# ── 日志配置（必须在其他模块导入前完成，确保工具注册日志可见）────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

from app.api.v1 import agent as agent_router              # noqa: E402
from app.api.v1 import auth as auth_router                # noqa: E402
from app.api.v1 import chat as chat_router                # noqa: E402
from app.api.v1 import collab as collab_router            # noqa: E402
from app.api.v1 import logs as logs_router                # noqa: E402
from app.api.v1 import livebench as livebench_router      # noqa: E402
from app.api.v1 import organize as organize_router        # noqa: E402
from app.api.v1 import deduction as deduction_router      # noqa: E402
from app.api.v1 import graph_deduction as graph_deduction_router  # noqa: E402
from app.api.v1 import discussion as discussion_router    # noqa: E402
from app.api.v1 import skills as skills_router            # noqa: E402
from app.api.v1 import documents as documents_router      # noqa: E402
from app.api.v1 import admin as admin_router              # noqa: E402
from app.api.v1 import memories as memories_router        # noqa: E402
from app.api.v1 import workspace as workspace_router      # noqa: E402
from app.api.v1 import debug_bridge as debug_bridge_router  # noqa: E402
from app.api.v1 import schedule as schedule_router        # noqa: E402
from app.services import log_store                        # noqa: E402
from app.services import skill_store                      # noqa: E402
from app.services import corwork_db                       # noqa: E402

# 导入 tools 模块，触发工具注册到全局 tool_registry
import app.tools.search          # noqa: F401, E402
import app.tools.read_document   # noqa: F401, E402
import app.tools.forward_message # noqa: F401, E402
import app.tools.save_memory     # noqa: F401, E402
import app.tools.file_tools      # noqa: F401, E402
import app.tools.debug_tools     # noqa: F401, E402
import app.tools.browser_read    # noqa: F401, E402
import app.tools.scheduler       # noqa: F401, E402
from app.tools.skill_runner import load_enabled_skills  # noqa: E402


# ── 应用生命周期 ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期钩子。"""
    # 初始化平台核心数据库（用户、消息、Agent 名片等）
    await corwork_db.init_db()
    logger.info("corwork_db initialized")
    # 初始化 Agent 执行日志数据库
    await log_store.init_db()
    logger.info("log_store initialized")
    # 初始化 Skill 数据库并种入内置 Skill
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
    description="Cor-AiWorker 后端服务，提供 Agent 编排、LLM 流式调用与协作消息能力。",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS（Android 模拟器 10.0.2.2 已加入白名单）
setup_cors(app)

# ── 路由注册 ──────────────────────────────────────────────────────────────────
app.include_router(auth_router.router, prefix="/v1")
app.include_router(collab_router.router, prefix="/v1")
app.include_router(admin_router.router, prefix="/v1")
app.include_router(chat_router.router, prefix="/v1")
app.include_router(agent_router.router, prefix="/v1")
app.include_router(logs_router.router, prefix="/v1")
app.include_router(livebench_router.router, prefix="/v1")
app.include_router(organize_router.router, prefix="/v1")
app.include_router(deduction_router.router, prefix="/v1")
app.include_router(graph_deduction_router.router, prefix="/v1")
app.include_router(discussion_router.router, prefix="/v1")
app.include_router(skills_router.router, prefix="/v1")
app.include_router(documents_router.router, prefix="/v1")
app.include_router(memories_router.router, prefix="/v1")
app.include_router(workspace_router.router, prefix="/v1")
app.include_router(debug_bridge_router.router, prefix="/v1")
app.include_router(schedule_router.router, prefix="/v1")


# ── 根路径重定向到管理面板 ────────────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/v1/admin/")


# ── 健康检查 ──────────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


logger.info("app started | debug=%s origins=%s", settings.debug, settings.allowed_origins)
