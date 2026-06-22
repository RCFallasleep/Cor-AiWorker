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

    # ── Browser Service（Playwright + browser-use）────────────────────────────
    # cor-browser 容器地址，未配置时 browser_read 工具返回友好错误提示
    browser_service_url: str | None = None

    # ── Scheduler Service（定时任务微服务）────────────────────────────────────
    # scheduler-service 调用主后端内部接口时使用的 service token（共享密钥）
    scheduler_service_token: str = "change-me-scheduler-token"
    # scheduler-service 容器地址（主后端调用 scheduler-service 时使用，预留）
    scheduler_service_url: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
