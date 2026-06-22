"""Skill 持久化存储服务（SQLite）。

Skill 是用户自建的 MCP 工具，由一组文件（.md / .py）组成。
每个 Skill 可被注册到 tool_registry，供 Agent 调用。

表结构：
  skills        — Skill 元数据（id, name, description, type, tags, enabled, ...）
  skill_files   — Skill 文件内容（skill_id, filename, content, language）
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

# SQLite 数据库路径（与 agent_logs.db 同目录）
_DB_PATH = Path(settings.log_db_path).parent / "skills.db"

# 内置工具源码目录（相对于本文件）
_TOOLS_DIR = Path(__file__).parent.parent / "tools"


def _read_tool_source(filename: str) -> str:
    """读取 app/tools/ 目录下的真实源文件内容。

    这样 _BUILTIN_SKILLS 里展示的代码与实际执行的代码始终保持一致，
    无需手动维护两份副本。
    """
    path = _TOOLS_DIR / filename
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("builtin tool source not found | path=%s", path)
        return f"# 源文件未找到：{path}\n"

_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _init_tables(_conn)
    return _conn


def _init_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS skills (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            skill_type  TEXT NOT NULL DEFAULT 'custom',
            tags        TEXT NOT NULL DEFAULT '[]',
            enabled     INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_files (
            id          TEXT PRIMARY KEY,
            skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            filename    TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            language    TEXT NOT NULL DEFAULT 'text',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
    """)
    conn.commit()

    # 幂等迁移：为 skills 表添加 tool_names 列（旧库升级）
    cols = [r[1] for r in conn.execute("PRAGMA table_info(skills)").fetchall()]
    if "tool_names" not in cols:
        conn.execute("ALTER TABLE skills ADD COLUMN tool_names TEXT NOT NULL DEFAULT '[]'")
        conn.commit()
        logger.info("skill_store: migrated skills table — added tool_names column")

    logger.info("skill_store: tables initialized | db=%s", _DB_PATH)


# ── 类型定义 ──────────────────────────────────────────────────────────────────

class SkillFile:
    def __init__(
        self,
        id: str,
        skill_id: str,
        filename: str,
        content: str,
        language: str,
        created_at: str,
        updated_at: str,
    ) -> None:
        self.id = id
        self.skill_id = skill_id
        self.filename = filename
        self.content = content
        self.language = language
        self.created_at = created_at
        self.updated_at = updated_at

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "skill_id": self.skill_id,
            "filename": self.filename,
            "content": self.content,
            "language": self.language,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class Skill:
    def __init__(
        self,
        id: str,
        name: str,
        description: str,
        skill_type: str,
        tags: list[str],
        enabled: bool,
        created_at: str,
        updated_at: str,
        files: list[SkillFile] | None = None,
        tool_names: list[str] | None = None,
    ) -> None:
        self.id = id
        self.name = name
        self.description = description
        self.skill_type = skill_type
        self.tags = tags
        self.enabled = enabled
        self.created_at = created_at
        self.updated_at = updated_at
        self.files: list[SkillFile] = files or []
        # 显式声明的工具名列表（内置 Skill 可包含多个工具）
        # 为空时由前端按命名规则推断
        self.tool_names: list[str] = tool_names or []

    def to_dict(self, include_files: bool = True) -> dict:
        d: dict = {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "skill_type": self.skill_type,
            "tags": self.tags,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            # 显式工具名列表（空列表表示由前端按命名规则推断）
            "tool_names": self.tool_names,
        }
        if include_files:
            d["files"] = [f.to_dict() for f in self.files]
        # 计算文件构成比例（GitHub 风格）
        d["composition"] = _calc_composition(self.files)
        return d


def _calc_composition(files: list[SkillFile]) -> list[dict]:
    """计算文件语言构成比例（按字符数）。"""
    lang_chars: dict[str, int] = {}
    for f in files:
        lang = f.language or "text"
        lang_chars[lang] = lang_chars.get(lang, 0) + len(f.content)
    total = sum(lang_chars.values()) or 1
    result = []
    for lang, chars in sorted(lang_chars.items(), key=lambda x: -x[1]):
        result.append({
            "language": lang,
            "percent": round(chars / total * 100, 1),
            "chars": chars,
        })
    return result


def _lang_from_filename(filename: str) -> str:
    """根据文件名推断语言。"""
    ext = Path(filename).suffix.lower()
    mapping = {
        ".py": "python",
        ".md": "markdown",
        ".ts": "typescript",
        ".js": "javascript",
        ".json": "json",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".sh": "shell",
        ".txt": "text",
    }
    return mapping.get(ext, "text")


def _row_to_skill(row: sqlite3.Row, files: list[SkillFile]) -> Skill:
    # tool_names 列可能在旧库中不存在（迁移前），安全读取
    try:
        raw_tool_names = row["tool_names"]
        tool_names = json.loads(raw_tool_names) if raw_tool_names else []
    except (IndexError, KeyError):
        tool_names = []
    return Skill(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        skill_type=row["skill_type"],
        tags=json.loads(row["tags"]),
        enabled=bool(row["enabled"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        files=files,
        tool_names=tool_names,
    )


def _row_to_file(row: sqlite3.Row) -> SkillFile:
    return SkillFile(
        id=row["id"],
        skill_id=row["skill_id"],
        filename=row["filename"],
        content=row["content"],
        language=row["language"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_skills(enabled_only: bool = False) -> list[Skill]:
    """列出所有 Skill（含文件列表）。"""
    conn = _get_conn()
    query = "SELECT * FROM skills"
    if enabled_only:
        query += " WHERE enabled = 1"
    query += " ORDER BY created_at DESC"
    rows = conn.execute(query).fetchall()
    skills = []
    for row in rows:
        files = _get_skill_files(conn, row["id"])
        skills.append(_row_to_skill(row, files))
    return skills


def get_skill(skill_id: str) -> Skill | None:
    """按 ID 获取 Skill（含文件内容）。"""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,)).fetchone()
    if row is None:
        return None
    files = _get_skill_files(conn, skill_id)
    return _row_to_skill(row, files)


def _get_skill_files(conn: sqlite3.Connection, skill_id: str) -> list[SkillFile]:
    rows = conn.execute(
        "SELECT * FROM skill_files WHERE skill_id = ? ORDER BY created_at ASC",
        (skill_id,),
    ).fetchall()
    return [_row_to_file(r) for r in rows]


def create_skill(
    name: str,
    description: str = "",
    skill_type: str = "custom",
    tags: list[str] | None = None,
    files: list[dict] | None = None,
    tool_names: list[str] | None = None,
) -> Skill:
    """创建新 Skill，可同时附带文件列表。

    files 格式：[{"filename": "tool.py", "content": "..."}]
    tool_names：显式声明该 Skill 包含的工具名（内置 Skill 可含多个）
    """
    conn = _get_conn()
    now = datetime.utcnow().isoformat()
    skill_id = str(uuid.uuid4())

    conn.execute(
        """INSERT INTO skills (id, name, description, skill_type, tags, enabled, tool_names, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)""",
        (skill_id, name, description, skill_type, json.dumps(tags or []),
         json.dumps(tool_names or []), now, now),
    )

    skill_files: list[SkillFile] = []
    for f in (files or []):
        sf = _upsert_file(conn, skill_id, f["filename"], f.get("content", ""), now)
        skill_files.append(sf)

    conn.commit()
    logger.info("skill created | id=%s name=%s files=%d", skill_id, name, len(skill_files))
    return Skill(
        id=skill_id,
        name=name,
        description=description,
        skill_type=skill_type,
        tags=tags or [],
        enabled=True,
        created_at=now,
        updated_at=now,
        files=skill_files,
        tool_names=tool_names or [],
    )


def update_skill(
    skill_id: str,
    name: str | None = None,
    description: str | None = None,
    skill_type: str | None = None,
    tags: list[str] | None = None,
    enabled: bool | None = None,
) -> Skill | None:
    """更新 Skill 元数据。"""
    conn = _get_conn()
    skill = get_skill(skill_id)
    if skill is None:
        return None

    now = datetime.utcnow().isoformat()
    new_name = name if name is not None else skill.name
    new_desc = description if description is not None else skill.description
    new_type = skill_type if skill_type is not None else skill.skill_type
    new_tags = tags if tags is not None else skill.tags
    new_enabled = enabled if enabled is not None else skill.enabled

    conn.execute(
        """UPDATE skills SET name=?, description=?, skill_type=?, tags=?, enabled=?, updated_at=?
           WHERE id=?""",
        (new_name, new_desc, new_type, json.dumps(new_tags), int(new_enabled), now, skill_id),
    )
    conn.commit()
    return get_skill(skill_id)


def delete_skill(skill_id: str) -> bool:
    """删除 Skill 及其所有文件。"""
    conn = _get_conn()
    conn.execute("DELETE FROM skill_files WHERE skill_id = ?", (skill_id,))
    result = conn.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
    conn.commit()
    deleted = result.rowcount > 0
    if deleted:
        logger.info("skill deleted | id=%s", skill_id)
    return deleted


def upsert_skill_file(skill_id: str, filename: str, content: str) -> SkillFile | None:
    """新增或更新 Skill 的某个文件。"""
    conn = _get_conn()
    if conn.execute("SELECT id FROM skills WHERE id = ?", (skill_id,)).fetchone() is None:
        return None
    now = datetime.utcnow().isoformat()
    sf = _upsert_file(conn, skill_id, filename, content, now)
    conn.commit()
    # 更新 skill 的 updated_at
    conn.execute("UPDATE skills SET updated_at=? WHERE id=?", (now, skill_id))
    conn.commit()
    return sf


def delete_skill_file(skill_id: str, file_id: str) -> bool:
    """删除 Skill 的某个文件。"""
    conn = _get_conn()
    result = conn.execute(
        "DELETE FROM skill_files WHERE id = ? AND skill_id = ?", (file_id, skill_id)
    )
    conn.commit()
    return result.rowcount > 0


def _upsert_file(
    conn: sqlite3.Connection, skill_id: str, filename: str, content: str, now: str
) -> SkillFile:
    """内部：按 skill_id + filename 做 upsert。"""
    existing = conn.execute(
        "SELECT id FROM skill_files WHERE skill_id = ? AND filename = ?",
        (skill_id, filename),
    ).fetchone()
    lang = _lang_from_filename(filename)
    if existing:
        file_id = existing["id"]
        conn.execute(
            "UPDATE skill_files SET content=?, language=?, updated_at=? WHERE id=?",
            (content, lang, now, file_id),
        )
    else:
        file_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO skill_files (id, skill_id, filename, content, language, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (file_id, skill_id, filename, content, lang, now, now),
        )
    return SkillFile(
        id=file_id,
        skill_id=skill_id,
        filename=filename,
        content=content,
        language=lang,
        created_at=now,
        updated_at=now,
    )


# ── 内置 Skill 定义（真实代码）────────────────────────────────────────────────

_BUILTIN_SKILLS: list[dict] = [
    {
        "name": "BrowserRead",
        "description": "浏览器读取工具，用真实浏览器（Playwright）访问指定 URL，提取完整页面正文。支持 JS 动态渲染、反爬页面。与 WebSearch 互补：WebSearch 用于关键词搜索，BrowserRead 用于读取已知 URL 的完整内容。",
        "skill_type": "builtin",
        "tags": ["browser", "web", "read", "playwright"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# BrowserRead Skill\n\n"
                    "用真实浏览器读取网页完整内容，突破反爬限制，支持 JS 动态渲染页面。\n\n"
                    "## 与 WebSearch 的区别\n\n"
                    "| 工具 | 适用场景 | 返回内容 |\n"
                    "|------|---------|----------|\n"
                    "| WebSearch | 关键词搜索，找信息 | 多条摘要（120字/条） |\n"
                    "| BrowserRead | 读取已知 URL | 完整页面正文（最多 8000 字） |\n\n"
                    "## 功能\n\n"
                    "- **真实浏览器**：基于 Playwright + Chromium，绕过 JS 渲染和 UA 检测\n"
                    "- **AI 驱动提取**：browser-use Agent 理解页面结构，智能提取所需内容\n"
                    "- **自动降级**：browser-use 失败时降级为纯 Playwright 提取\n"
                    "- **防 SSRF**：自动拒绝内网地址访问\n\n"
                    "## 参数\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `url` | string | ✓ | 要读取的网页完整地址（http/https） |\n"
                    "| `task` | string | ✗ | 告诉 Agent 具体提取什么，如「提取文章标题和正文」 |\n\n"
                    "## 配置\n\n"
                    "需要在 docker-compose.yml 中启动 cor-browser 服务：\n\n"
                    "```yaml\n"
                    "browser-service:\n"
                    "  build: ./browser-service\n"
                    "```\n\n"
                    "并在后端环境变量中设置：\n\n"
                    "```env\n"
                    "BROWSER_SERVICE_URL=http://browser-service:7788\n"
                    "```\n\n"
                    "## 注意事项\n\n"
                    "- 每次调用启动真实浏览器，耗时约 15-30 秒\n"
                    "- 内部 LLM 使用用户的 API Key，会消耗额外 token\n"
                    "- 仅在 WebSearch 无法获取完整内容时使用\n"
                ),
            },
            {
                "filename": "browser_read.py",
                "content": _read_tool_source("browser_read.py"),
            },
        ],
    },
    {
        "name": "WebSearch",
        "description": "联网搜索工具，基于 SearXNG 实例，获取实时信息、新闻、数据。智能提炼高价值内容，过滤广告噪声。",
        "skill_type": "builtin",
        "tags": ["search", "web", "realtime"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# WebSearch Skill\n\n"
                    "基于 SearXNG 的联网搜索工具，为 Agent 提供实时联网能力。\n\n"
                    "## 功能\n\n"
                    "- **实时联网搜索**：调用自托管 SearXNG 实例，获取最新信息\n"
                    "- **智能内容提炼**：优先保留含数字、日期、温度、货币等高价值句子\n"
                    "- **噪声过滤**：自动去除广告、导航、版权等无效内容\n"
                    "- **超时与错误处理**：15s 超时，HTTP 错误友好提示\n\n"
                    "## 参数\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `query` | string | ✓ | 搜索关键词，简洁精准，如「重庆 天气 今天」 |\n\n"
                    "## 配置\n\n"
                    "需要在环境变量中设置：\n\n"
                    "```env\n"
                    "SEARXNG_BASE_URL=http://your-searxng-instance:8080\n"
                    "```\n\n"
                    "## 返回格式\n\n"
                    "```\n"
                    "搜索「关键词」：\n"
                    "· 标题1：提炼后的摘要内容...\n"
                    "· 标题2：提炼后的摘要内容...\n"
                    "```\n\n"
                    "最多返回 5 条结果，每条摘要不超过 120 字。\n"
                ),
            },
            {
                "filename": "search.py",
                "content": _read_tool_source("search.py"),
            },
        ],
    },
    {
        "name": "ReadDocument",
        "description": "读取用户上传的文档内容，支持 PDF / DOCX / TXT / MD，自动分块（每块约 1500 字），Agent 按需按块读取，适合处理大文件。",
        "skill_type": "builtin",
        "tags": ["document", "pdf", "read", "file"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# ReadDocument Skill\n\n"
                    "让 Agent 按需读取用户上传的文档内容，支持大文件分块读取。\n\n"
                    "## 功能\n\n"
                    "- **多格式支持**：PDF、DOCX/DOC、TXT、MD\n"
                    "- **自动分块**：每块约 1500 字，在段落边界切分，避免截断语义\n"
                    "- **按需读取**：Agent 从 chunk_index=0 开始，根据需要递增读取后续块\n"
                    "- **TTL 管理**：文档上传后 2 小时内有效，过期自动清理\n\n"
                    "## 参数\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `file_id` | string | ✓ | 文档 ID，由上传接口返回 |\n"
                    "| `chunk_index` | integer | ✗ | 块序号，从 0 开始，默认 0 |\n\n"
                    "## 返回格式\n\n"
                    "```\n"
                    "[文档块 1/3]（共 3 块，如需继续请调用 read_document(file_id='xxx', chunk_index=1)）\n\n"
                    "文档正文内容...\n"
                    "```\n\n"
                    "## 使用流程\n\n"
                    "1. 用户在对话框上传文档\n"
                    "2. 系统自动解析并在 system prompt 中注入文件信息\n"
                    "3. Agent 调用 `read_document` 工具读取内容\n"
                    "4. 如有多块，根据返回提示递增 chunk_index 继续读取\n"
                ),
            },
            {
                "filename": "document_store.py",
                "content": _read_tool_source("../services/document_store.py"),
            },
            {
                "filename": "read_document.py",
                "content": _read_tool_source("read_document.py"),
            },
        ],
    },
    {
        "name": "ForwardMessage",
        "description": "协作工具：将用户的消息通过 Agent 转发给指定联系人。对方会收到一条特殊标注的消息，显示「TA 的 Agent，转发自 [发起人]」。在交流协作的 Agent 对话中使用。",
        "skill_type": "collab",
        "tags": ["collab", "message", "forward"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# ForwardMessage Skill\n\n"
                    "协作工具：让 Agent 代替用户将消息转发给联系人。\n\n"
                    "## 功能\n\n"
                    "- **Agent 转发**：以 `agent_forward` 消息类型写入数据库\n"
                    "- **实时推送**：通过 WebSocket 推送给接收方（如果在线）\n"
                    "- **特殊标注**：对方看到「TA 的 Agent，转发自 [发起人]」紫色气泡\n\n"
                    "## 参数\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `receiver_id` | string | ✓ | 接收方用户 ID |\n"
                    "| `content` | string | ✓ | 要转发的消息内容 |\n"
                    "| `sender_id` | string | ✓ | 发起转发的用户 ID |\n\n"
                    "## 使用场景\n\n"
                    "在「交流协作 → Agent 起草」页面，用户确认消息后，Agent 调用此工具发送。\n"
                ),
            },
            {
                "filename": "forward_message.py",
                "content": _read_tool_source("forward_message.py"),
            },
        ],
    },
    {
        "name": "SaveMemory",
        "description": "协作工具：将重要信息保存为 Agent 记忆，供后续对话参考或在 Agent 养成页查看。支持 soul / memory / user / common 四种记忆类型。",
        "skill_type": "collab",
        "tags": ["collab", "memory", "save"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# SaveMemory Skill\n\n"
                    "协作工具：让 Agent 将重要信息持久化为记忆条目。\n\n"
                    "## 功能\n\n"
                    "- **四层记忆**：soul（人设）/ memory（经历）/ user（用户性格）/ common（公共，对方 Agent 可见）\n"
                    "- **持久化**：写入后端 `agent_memories` 表，在 Agent 养成页「记忆」Tab 可查看\n"
                    "- **跨对话共享**：common 类型记忆会在对方 Agent 起草消息时自动注入\n\n"
                    "## 参数\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `user_id` | string | ✓ | 记忆归属的用户 ID |\n"
                    "| `type` | string | ✓ | 记忆类型：soul / memory / user / common |\n"
                    "| `content` | string | ✓ | 记忆内容 |\n"
                    "| `title` | string | ✗ | 记忆标题（可选） |\n\n"
                    "## 触发时机\n\n"
                    "用户在 Agent 对话中说「记住这个」「存到记忆」等指令时，Agent 自动调用。\n"
                ),
            },
            {
                "filename": "save_memory.py",
                "content": _read_tool_source("save_memory.py"),
            },
        ],
    },
    {
        "name": "FileTools",
        "description": "工作区文件操作工具集：list_dir（列出目录结构）、read_file（读取文件内容，支持行范围）、write_file（完整覆盖写入文件）。Editor Agent 的核心工具。",
        "skill_type": "builtin",
        "tags": ["file", "workspace", "read", "write"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# FileTools Skill\n\n"
                    "工作区文件操作工具集，为 Editor Agent 提供本地文件读写能力。\n\n"
                    "## 工具列表\n\n"
                    "### list_dir(path)\n"
                    "列出指定目录的文件和子目录结构（最多 3 层）。\n\n"
                    "### read_file(path, start_line?, end_line?)\n"
                    "读取工作区文件内容，支持按行范围读取大文件。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `path` | string | ✓ | 相对于工作区根目录的文件路径 |\n"
                    "| `start_line` | integer | ✗ | 起始行号（从 1 开始） |\n"
                    "| `end_line` | integer | ✗ | 结束行号（含） |\n\n"
                    "### write_file(path, content)\n"
                    "完整覆盖写入文件内容。写之前建议先用 read_file 读取原内容。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `path` | string | ✓ | 相对于工作区根目录的文件路径 |\n"
                    "| `content` | string | ✓ | 要写入的完整文件内容 |\n\n"
                    "## 配置\n\n"
                    "需要先通过 `/v1/workspace/open` 接口打开工作区，工具才能访问文件。\n"
                ),
            },
            {
                "filename": "file_tools.py",
                "content": _read_tool_source("file_tools.py"),
            },
        ],
    },
    {
        "name": "DebugTools",
        "description": "Android Studio 断点调试工具集：get_debug_snapshot（获取当前断点快照）、set_breakpoint（推送断点建议）、wait_for_breakpoint（等待新断点命中）。",
        "skill_type": "builtin",
        "tags": ["debug", "android", "breakpoint", "snapshot"],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# DebugTools Skill\n\n"
                    "Android Studio 断点调试辅助工具集，让 Agent 能感知和分析断点状态。\n\n"
                    "## 工具列表\n\n"
                    "### get_debug_snapshot()\n"
                    "获取 Android Studio 最新断点快照，包含变量值、调用栈等信息。\n\n"
                    "### set_breakpoint(file, line, condition?)\n"
                    "向 Android Studio 推送断点建议（需要 AS 插件配合）。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `file` | string | ✓ | 源文件路径（相对路径） |\n"
                    "| `line` | integer | ✓ | 断点行号 |\n"
                    "| `condition` | string | ✗ | 条件表达式（可选） |\n\n"
                    "### wait_for_breakpoint(timeout_seconds?)\n"
                    "阻塞等待新断点命中，超时后返回。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `timeout_seconds` | integer | ✗ | 等待超时秒数，默认 60 |\n\n"
                    "## 使用流程\n\n"
                    "1. 在 Android Studio 中安装配套插件\n"
                    "2. 运行 App，触发断点\n"
                    "3. Agent 调用 `get_debug_snapshot` 获取快照\n"
                    "4. Agent 分析变量状态，给出调试建议\n"
                ),
            },
            {
                "filename": "debug_tools.py",
                "content": _read_tool_source("debug_tools.py"),
            },
        ],
    },
    {
        "name": "Scheduler",
        "description": "定时任务工具：通过自然语言创建定时提醒（如「30分钟后提醒我开会」），查看任务列表，取消已有任务。任务到期后 Agent 会主动发消息提醒你。",
        "skill_type": "builtin",
        "tags": ["scheduler", "reminder", "task", "timer"],
        # 显式声明该 Skill 包含的所有工具名（一对多映射）
        "tool_names": [
            "create_scheduled_task",
            "list_scheduled_tasks",
            "cancel_scheduled_task",
        ],
        "files": [
            {
                "filename": "README.md",
                "content": (
                    "# Scheduler Skill\n\n"
                    "定时任务工具，让 Agent 能够创建、查看和取消定时提醒。\n\n"
                    "## 工具列表\n\n"
                    "### create_scheduled_task(title, remind_at, description?)\n"
                    "创建一个定时提醒任务。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `title` | string | ✓ | 任务标题，如「开会提醒」 |\n"
                    "| `remind_at` | string | ✓ | 提醒时间，ISO 8601 格式，如 `2024-01-15T14:30:00` |\n"
                    "| `description` | string | ✗ | 任务详细描述（可选） |\n\n"
                    "### list_scheduled_tasks(status?)\n"
                    "查看定时任务列表。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `status` | string | ✗ | 过滤状态：active / completed / cancelled，默认返回全部 |\n\n"
                    "### cancel_scheduled_task(task_id)\n"
                    "取消一个定时任务。\n\n"
                    "| 参数 | 类型 | 必填 | 说明 |\n"
                    "|------|------|------|------|\n"
                    "| `task_id` | string | ✓ | 任务 ID（从 list_scheduled_tasks 获取） |\n\n"
                    "## 使用示例\n\n"
                    "- 「30分钟后提醒我喝水」\n"
                    "- 「明天上午10点提醒我开周会」\n"
                    "- 「查看我的定时任务」\n"
                    "- 「取消那个喝水提醒」\n\n"
                    "## 工作原理\n\n"
                    "1. 用户在对话中说出提醒需求\n"
                    "2. Agent 调用 `create_scheduled_task` 创建任务\n"
                    "3. 后台 scheduler-service 轮询到期任务\n"
                    "4. 到期后 Agent 主动发消息提醒用户\n"
                    "5. 可在工作台「定时任务」页面查看所有任务和执行记录\n"
                ),
            },
            {
                "filename": "scheduler.py",
                "content": _read_tool_source("scheduler.py"),
            },
        ],
    },
]


# ── 种子初始化 ────────────────────────────────────────────────────────────────

def seed_builtin_skills() -> None:
    """初始化/同步内置 Skill。

    策略：
    - 若数据库为空 → 全量创建
    - 若已有内置 Skill → upsert 文件内容 + 同步 tool_names（保留用户对其他元数据的修改）
    """
    conn = _get_conn()
    now = datetime.utcnow().isoformat()

    for spec in _BUILTIN_SKILLS:
        # 按名称查找已有内置/collab Skill（skill_type 可能是 builtin 或 collab）
        row = conn.execute(
            "SELECT id FROM skills WHERE name = ? AND skill_type IN ('builtin', 'collab')",
            (spec["name"],),
        ).fetchone()

        spec_tool_names = spec.get("tool_names", [])

        if row is None:
            # 首次创建
            skill = create_skill(
                name=spec["name"],
                description=spec["description"],
                skill_type=spec["skill_type"],
                tags=spec["tags"],
                files=spec["files"],
                tool_names=spec_tool_names,
            )
            logger.info("seeded builtin skill | id=%s name=%s", skill.id, skill.name)
        else:
            # 已存在：同步文件内容 + tool_names（始终以代码为准）
            skill_id = row["id"]
            for f in spec["files"]:
                _upsert_file(conn, skill_id, f["filename"], f["content"], now)
            conn.execute(
                "UPDATE skills SET tool_names=?, updated_at=? WHERE id=?",
                (json.dumps(spec_tool_names), now, skill_id),
            )
            conn.commit()
            logger.info("synced builtin skill files | id=%s name=%s", skill_id, spec["name"])
