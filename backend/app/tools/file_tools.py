"""
file_tools.py — 本地文件系统 MCP 工具

注册三个工具到全局 tool_registry：
  - list_dir      列出工作区目录结构
  - read_file     读取文件内容
  - write_file    写入/覆盖文件内容

所有路径操作均通过 workspace_service.resolve_path() 校验，
确保 Agent 只能操作用户已授权的工作区目录内的文件。
"""
from __future__ import annotations

import logging
from pathlib import Path

from app.tools.registry import ToolDefinition, tool_registry
from app.services import workspace_service

logger = logging.getLogger(__name__)

# ── list_dir ──────────────────────────────────────────────────────────────────

async def _list_dir_handler(path: str = "") -> str:
    """
    列出工作区目录结构。
    path 为空时列出工作区根目录，否则列出指定子目录。
    """
    try:
        root = workspace_service.require_workspace()
        if path:
            target = workspace_service.resolve_path(path)
            if not target.is_dir():
                return f"[错误] {path} 不是目录"
        else:
            target = root

        def _fmt(nodes: list[dict], indent: int = 0) -> list[str]:
            lines = []
            prefix = "  " * indent
            for node in nodes:
                if node["type"] == "dir":
                    lines.append(f"{prefix}📁 {node['name']}/")
                    lines.extend(_fmt(node.get("children", []), indent + 1))
                else:
                    lines.append(f"{prefix}📄 {node['name']}")
            return lines

        tree = workspace_service.build_file_tree(target)
        if not tree:
            return f"目录为空：{path or '（工作区根目录）'}"

        lines = [f"工作区：{root}", f"目录：{path or '/'}"]
        lines.extend(_fmt(tree))
        return "\n".join(lines)

    except RuntimeError as e:
        return f"[错误] {e}"
    except PermissionError as e:
        return f"[错误] {e}"
    except Exception as e:
        logger.error("list_dir failed | error=%s", e, exc_info=True)
        return f"[错误] 列出目录失败：{e}"


tool_registry.register(ToolDefinition(
    name="list_dir",
    description=(
        "列出工作区目录结构（文件树）。"
        "path 参数为相对于工作区根目录的路径，留空则列出根目录。"
        "使用此工具了解项目结构，再决定读取哪些文件。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "要列出的目录路径（相对于工作区根目录），留空则列出根目录",
            }
        },
        "required": [],
    },
    handler=_list_dir_handler,
))

# ── read_file ─────────────────────────────────────────────────────────────────

_MAX_READ_BYTES = 200_000   # 单次最多读取 200KB，防止超大文件撑爆 context


async def _read_file_handler(path: str, start_line: int = 1, end_line: int = 0) -> str:
    """
    读取工作区内指定文件的内容。
    支持按行范围读取（start_line/end_line），end_line=0 表示读到末尾。
    """
    try:
        file_path = workspace_service.resolve_path(path)
        if not file_path.exists():
            return f"[错误] 文件不存在：{path}"
        if not file_path.is_file():
            return f"[错误] {path} 不是文件"

        size = file_path.stat().st_size
        if size > _MAX_READ_BYTES and start_line == 1 and end_line == 0:
            return (
                f"[提示] 文件较大（{size // 1024}KB），建议使用 start_line/end_line 参数分段读取。"
                f"文件共 {sum(1 for _ in file_path.open(encoding='utf-8', errors='replace'))} 行。"
            )

        content = file_path.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines(keepends=True)
        total = len(lines)

        # 行范围截取
        s = max(1, start_line) - 1
        e = total if end_line <= 0 else min(end_line, total)
        selected = lines[s:e]

        result_text = "".join(selected)
        header = f"文件：{path}  （第 {s+1}–{e} 行，共 {total} 行）\n"
        header += "─" * 60 + "\n"
        return header + result_text

    except RuntimeError as e:
        return f"[错误] {e}"
    except PermissionError as e:
        return f"[错误] {e}"
    except Exception as e:
        logger.error("read_file failed | path=%s error=%s", path, e, exc_info=True)
        return f"[错误] 读取文件失败：{e}"


tool_registry.register(ToolDefinition(
    name="read_file",
    description=(
        "读取工作区内指定文件的内容。"
        "支持 start_line/end_line 参数分段读取大文件（行号从 1 开始，end_line=0 表示读到末尾）。"
        "读取前请先用 list_dir 确认文件路径。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（相对于工作区根目录）",
            },
            "start_line": {
                "type": "integer",
                "description": "起始行号（从 1 开始，默认 1）",
            },
            "end_line": {
                "type": "integer",
                "description": "结束行号（包含，0 表示读到末尾，默认 0）",
            },
        },
        "required": ["path"],
    },
    handler=_read_file_handler,
))

# ── write_file ────────────────────────────────────────────────────────────────

async def _write_file_handler(path: str, content: str, create_dirs: bool = True) -> str:
    """
    写入/覆盖工作区内指定文件的内容。
    create_dirs=True 时自动创建父目录。
    """
    try:
        file_path = workspace_service.resolve_path(path)

        if create_dirs:
            file_path.parent.mkdir(parents=True, exist_ok=True)
        elif not file_path.parent.exists():
            return f"[错误] 父目录不存在：{file_path.parent}"

        file_path.write_text(content, encoding="utf-8")
        lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
        size = file_path.stat().st_size
        logger.info("write_file | path=%s lines=%d size=%d", path, lines, size)
        return f"✅ 已写入：{path}（{lines} 行，{size} 字节）"

    except RuntimeError as e:
        return f"[错误] {e}"
    except PermissionError as e:
        return f"[错误] {e}"
    except Exception as e:
        logger.error("write_file failed | path=%s error=%s", path, e, exc_info=True)
        return f"[错误] 写入文件失败：{e}"


tool_registry.register(ToolDefinition(
    name="write_file",
    description=(
        "写入/覆盖工作区内指定文件的内容。"
        "如果文件不存在会自动创建；如果文件已存在会完整覆盖。"
        "写入前请先用 read_file 读取原始内容，确保不丢失未修改的部分。"
        "只能操作用户已打开的工作区目录内的文件。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（相对于工作区根目录）",
            },
            "content": {
                "type": "string",
                "description": "要写入的完整文件内容（会覆盖原有内容）",
            },
            "create_dirs": {
                "type": "boolean",
                "description": "是否自动创建父目录（默认 true）",
            },
        },
        "required": ["path", "content"],
    },
    handler=_write_file_handler,
))

logger.info("file_tools registered | list_dir, read_file, write_file")
