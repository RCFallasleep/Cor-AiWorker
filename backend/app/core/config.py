from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Cor-AiWorker Backend"
    debug: bool = False

    # 允许跨域的前端地址，逗号分隔
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # SearXNG 联网搜索
    searxng_base_url: str | None = None

    # Agent 执行日志 SQLite 数据库路径（相对于后端工作目录）
    log_db_path: str = "/data/agent_logs.db"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
