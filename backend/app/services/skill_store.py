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
                "content": (
                    'from __future__ import annotations\n'
                    '\n'
                    'import logging\n'
                    'import re\n'
                    '\n'
                    'import httpx\n'
                    '\n'
                    'from app.core.config import settings\n'
                    'from app.tools.registry import ToolDefinition, tool_registry\n'
                    '\n'
                    'logger = logging.getLogger(__name__)\n'
                    '\n'
                    '# 每次搜索返回的最大结果条数\n'
                    '_MAX_RESULTS = 5\n'
                    '# 注入给模型的每条结果最大字符数（提炼后）\n'
                    '_MAX_SNIPPET_CHARS = 120\n'
                    '\n'
                    '\n'
                    'def _extract_key_sentences(text: str, max_chars: int) -> str:\n'
                    '    """从摘要文本中提取信息密度最高的内容注入给模型。\n'
                    '\n'
                    '    策略：\n'
                    '    1. 按句子切分（。！？.!?）\n'
                    '    2. 优先保留含数字、日期、温度、地名等关键信息的句子\n'
                    '    3. 去掉明显的导航/广告废话（"点击查看"、"更多内容"等）\n'
                    '    4. 拼接到 max_chars 为止\n'
                    '    """\n'
                    '    if not text:\n'
                    '        return ""\n'
                    '\n'
                    '    # 过滤废话模式\n'
                    '    noise_patterns = re.compile(\n'
                    '        r"(点击|查看更多|阅读全文|来源：|转载|版权|广告|订阅|关注|下载|APP|扫码|二维码"\n'
                    '        r"|copyright|read more|click here|subscribe)",\n'
                    '        re.IGNORECASE,\n'
                    '    )\n'
                    '\n'
                    '    # 高价值内容模式（含数字、温度、日期、百分比、货币等）\n'
                    '    value_patterns = re.compile(\n'
                    '        r"(\\d+[°℃%℉]|\\d{4}年|\\d+月\\d+日|\\d+:\\d+|[￥$€£]\\d+|\\d+\\.\\d+|"\n'
                    '        r"最高|最低|气温|天气|晴|雨|阴|雪|风|湿度|降水|预报)"\n'
                    '    )\n'
                    '\n'
                    '    # 按句子切分\n'
                    '    sentences = re.split(r"(?<=[。！？.!?])\\s*", text)\n'
                    '    sentences = [s.strip() for s in sentences if s.strip()]\n'
                    '\n'
                    '    # 分两组：高价值句 + 普通句（都过滤废话）\n'
                    '    high_value: list[str] = []\n'
                    '    normal: list[str] = []\n'
                    '    for s in sentences:\n'
                    '        if noise_patterns.search(s):\n'
                    '            continue\n'
                    '        if value_patterns.search(s):\n'
                    '            high_value.append(s)\n'
                    '        else:\n'
                    '            normal.append(s)\n'
                    '\n'
                    '    # 优先拼接高价值句，不够再补普通句\n'
                    '    result = ""\n'
                    '    for s in high_value + normal:\n'
                    '        if len(result) + len(s) + 1 > max_chars:\n'
                    '            remaining = max_chars - len(result)\n'
                    '            if remaining > 20:\n'
                    '                result += s[:remaining]\n'
                    '            break\n'
                    '        result += s + " "\n'
                    '\n'
                    '    return result.strip() or text[:max_chars]\n'
                    '\n'
                    '\n'
                    'async def _web_search_handler(query: str) -> str:\n'
                    '    """调用 SearXNG 实例执行联网搜索，返回提炼后的精简结果。"""\n'
                    '    base_url = settings.searxng_base_url\n'
                    '    if not base_url:\n'
                    '        return "[错误] 未配置 SearXNG 实例地址（SEARXNG_BASE_URL），无法执行联网搜索。"\n'
                    '\n'
                    '    params = {\n'
                    '        "q": query,\n'
                    '        "format": "json",\n'
                    '        "language": "zh-CN",\n'
                    '        "safesearch": "1",\n'
                    '    }\n'
                    '\n'
                    '    try:\n'
                    '        async with httpx.AsyncClient(timeout=15.0) as client:\n'
                    '            resp = await client.get(f"{base_url}/search", params=params)\n'
                    '            resp.raise_for_status()\n'
                    '            data = resp.json()\n'
                    '    except httpx.TimeoutException:\n'
                    '        logger.warning("searxng timeout | query=%s", query)\n'
                    '        return f"[错误] 搜索超时。查询：{query}"\n'
                    '    except httpx.HTTPStatusError as e:\n'
                    '        logger.error("searxng http error | status=%s query=%s", e.response.status_code, query)\n'
                    '        return f"[错误] 搜索服务异常（{e.response.status_code}）。"\n'
                    '    except Exception as e:\n'
                    '        logger.error("searxng error | %s", e, exc_info=True)\n'
                    '        return f"[错误] 搜索失败：{e}"\n'
                    '\n'
                    '    results = data.get("results", [])\n'
                    '    if not results:\n'
                    '        return f"未找到「{query}」的相关结果。"\n'
                    '\n'
                    '    # 提炼每条结果，只保留信息密度高的内容\n'
                    '    lines = [f"搜索「{query}」："]\n'
                    '    kept = 0\n'
                    '    for r in results:\n'
                    '        if kept >= _MAX_RESULTS:\n'
                    '            break\n'
                    '        title   = r.get("title", "").strip()\n'
                    '        content = r.get("content", "").strip()\n'
                    '        snippet = _extract_key_sentences(content, _MAX_SNIPPET_CHARS)\n'
                    '        if title:\n'
                    '            line = f"· {title}"\n'
                    '            if snippet:\n'
                    '                line += f"：{snippet}"\n'
                    '            lines.append(line)\n'
                    '            kept += 1\n'
                    '\n'
                    '    logger.debug(\n'
                    '        "web_search | query=%s results_raw=%d results_kept=%d output_chars=%d",\n'
                    '        query, len(results), kept, sum(len(l) for l in lines),\n'
                    '    )\n'
                    '    return "\\n".join(lines)\n'
                    '\n'
                    '\n'
                    '# ── 注册到全局 Tool 注册表 ────────────────────────────────────────────────────\n'
                    '\n'
                    'web_search_tool = ToolDefinition(\n'
                    '    name="web_search",\n'
                    '    description=(\n'
                    '        "联网搜索工具。获取实时信息、最新新闻、当前数据时使用。"\n'
                    '        "返回已提炼的关键信息，通常 1 次搜索即可回答问题。"\n'
                    '        "若结果不理想，换不同关键词再搜 1 次，之后直接基于已有信息回答。"\n'
                    '    ),\n'
                    '    parameters={\n'
                    '        "type": "object",\n'
                    '        "properties": {\n'
                    '            "query": {\n'
                    '                "type": "string",\n'
                    '                "description": "搜索关键词，简洁精准，如「重庆 天气 今天」",\n'
                    '            },\n'
                    '        },\n'
                    '        "required": ["query"],\n'
                    '    },\n'
                    '    handler=_web_search_handler,\n'
                    ')\n'
                    '\n'
                    'tool_registry.register(web_search_tool)\n'
                ),
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
        # 按名称查找已有内置 Skill
        row = conn.execute(
            "SELECT id FROM skills WHERE name = ? AND skill_type = 'builtin'",
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
