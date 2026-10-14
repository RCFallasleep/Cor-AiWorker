from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings


def setup_cors(app: FastAPI) -> None:
    """注册 CORS 中间件，允许前端跨域访问。
    
    开发阶段：allow_origin_regex 匹配所有来源（含手机局域网访问）
    生产阶段：收窄 allowed_origins，去掉 regex
    """
    origins = settings.allowed_origins
    # 如果配置里包含 "*"，改用 regex 匹配所有来源（避免与 credentials 冲突）
    if "*" in origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=".*",
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
