from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Cor-AiWorker Backend"
    debug: bool = False

    # 允许跨域的前端地址，逗号分隔
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        # Android 模拟器访问宿主机
        "http://10.0.2.2:3000",
    ]

    # ── 数据库路径 ────────────────────────────────────────────────────────────
    # Agent 执行日志（现有，保持不变）
    log_db_path: str = "/data/agent_logs.db"

    # 平台核心数据库：用户、消息协作、Agent 名片等
    # 与 log_db_path 同目录，方便统一备份
    corwork_db_path: str = "/data/corwork.db"

    # ── JWT 认证 ──────────────────────────────────────────────────────────────
    jwt_secret: str = "change-me-in-production-use-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 30  # 30 天

    # ── SearXNG 联网搜索 ──────────────────────────────────────────────────────
    searxng_base_url: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
