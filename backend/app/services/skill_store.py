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
) -> Skill:
    """创建新 Skill，可同时附带文件列表。

    files 格式：[{"filename": "tool.py", "content": "..."}]
    """
    conn = _get_conn()
    now = datetime.utcnow().isoformat()
    skill_id = str(uuid.uuid4())

    conn.execute(
        """INSERT INTO skills (id, name, description, skill_type, tags, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
        (skill_id, name, description, skill_type, json.dumps(tags or []), now, now),
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
]


# ── 种子初始化 ────────────────────────────────────────────────────────────────

def seed_builtin_skills() -> None:
    """初始化/同步内置 Skill。

    策略：
    - 若数据库为空 → 全量创建
    - 若已有内置 Skill → 只 upsert 文件内容（保留用户对元数据的修改，但始终同步最新代码）
    """
    conn = _get_conn()
    now = datetime.utcnow().isoformat()

    for spec in _BUILTIN_SKILLS:
        # 按名称查找已有内置/collab Skill（skill_type 可能是 builtin 或 collab）
        row = conn.execute(
            "SELECT id FROM skills WHERE name = ? AND skill_type IN ('builtin', 'collab')",
            (spec["name"],),
        ).fetchone()

        if row is None:
            # 首次创建
            skill = create_skill(
                name=spec["name"],
                description=spec["description"],
                skill_type=spec["skill_type"],
                tags=spec["tags"],
                files=spec["files"],
            )
            logger.info("seeded builtin skill | id=%s name=%s", skill.id, skill.name)
        else:
            # 已存在：只同步文件内容（upsert），不改元数据
            skill_id = row["id"]
            for f in spec["files"]:
                _upsert_file(conn, skill_id, f["filename"], f["content"], now)
            conn.execute(
                "UPDATE skills SET updated_at=? WHERE id=?", (now, skill_id)
            )
            conn.commit()
            logger.info("synced builtin skill files | id=%s name=%s", skill_id, spec["name"])
