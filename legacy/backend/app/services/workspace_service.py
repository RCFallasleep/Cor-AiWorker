"""
workspace_service.py — 本地工作区管理

维护当前打开的工作区根目录（workspace_root），
所有文件操作都必须通过 resolve_path() 校验路径在根目录内。
"""
from __future__ import annotations

import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ── 内存状态（单进程单工作区）────────────────────────────────────────────────
_workspace_root: Path | None = None


def set_workspace(path: str) -> Path:
    """设置工作区根目录，返回规范化后的 Path。路径不存在时抛 ValueError。"""
    global _workspace_root
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise ValueError(f"路径不存在：{path}")
    if not p.is_dir():
        raise ValueError(f"路径不是目录：{path}")
    _workspace_root = p
    logger.info("workspace set | root=%s", p)
    return p


def get_workspace() -> Path | None:
    """返回当前工作区根目录，未设置时返回 None。"""
    return _workspace_root


def require_workspace() -> Path:
    """返回当前工作区根目录，未设置时抛 RuntimeError。"""
    if _workspace_root is None:
        raise RuntimeError("尚未打开工作区，请先调用 open_workspace 接口")
    return _workspace_root


def resolve_path(rel_or_abs: str) -> Path:
    """
    将相对路径或绝对路径解析为工作区内的绝对路径。
    - 相对路径：相对于 workspace_root
    - 绝对路径：必须在 workspace_root 内
    校验失败时抛 PermissionError。
    """
    root = require_workspace()
    p = Path(rel_or_abs)
    if not p.is_absolute():
        p = root / p
    p = p.resolve()
    # 安全校验：必须在 workspace_root 内
    try:
        p.relative_to(root)
    except ValueError:
        raise PermissionError(f"路径越界：{rel_or_abs} 不在工作区 {root} 内")
    return p


# ── 文件树构建 ────────────────────────────────────────────────────────────────

# 忽略的目录/文件名（不递归进入）
_IGNORE_DIRS = {
    ".git", ".svn", ".hg",
    "node_modules", ".next", "out", "dist", "build",
    "__pycache__", ".venv", "venv", "env",
    ".gradle", ".idea", ".kotlin",
    "*.egg-info",
}

_IGNORE_EXTENSIONS = {
    ".pyc", ".pyo", ".class", ".o", ".so", ".dylib",
    ".jar", ".aar", ".apk", ".aab",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
    ".mp4", ".mp3", ".mov",
    ".zip", ".tar", ".gz", ".rar",
    ".pdf",
}

_MAX_FILES = 500   # 单次最多返回文件数，防止超大项目卡死


def build_file_tree(root: Path | None = None, max_depth: int = 6) -> list[dict]:
    """
    递归构建文件树，返回 JSON 可序列化的列表。

    每个节点格式：
    {
        "name": "src",
        "path": "src",          # 相对于 workspace_root 的路径
        "type": "dir" | "file",
        "children": [...]       # 仅 dir 有此字段
    }
    """
    if root is None:
        root = require_workspace()
    counter = [0]

    def _walk(dir_path: Path, rel_base: str, depth: int) -> list[dict]:
        if depth > max_depth or counter[0] >= _MAX_FILES:
            return []
        nodes: list[dict] = []
        try:
            entries = sorted(dir_path.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
        except PermissionError:
            return []

        for entry in entries:
            if entry.name.startswith(".") and entry.name not in {".env.example"}:
                continue
            if entry.name in _IGNORE_DIRS:
                continue
            rel_path = f"{rel_base}/{entry.name}" if rel_base else entry.name

            if entry.is_dir():
                children = _walk(entry, rel_path, depth + 1)
                nodes.append({"name": entry.name, "path": rel_path, "type": "dir", "children": children})
            elif entry.is_file():
                if entry.suffix.lower() in _IGNORE_EXTENSIONS:
                    continue
                counter[0] += 1
                nodes.append({"name": entry.name, "path": rel_path, "type": "file"})

        return nodes

    return _walk(root, "", 0)
