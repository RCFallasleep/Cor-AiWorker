"""
workspace.py — 本地工作区 API

提供前端操作本地文件系统的 HTTP 接口：
  POST /v1/workspace/open      打开工作区（设置 workspace_root）
  GET  /v1/workspace/info      获取当前工作区信息
  GET  /v1/workspace/locate    按文件夹名在本机常见路径下搜索，返回候选完整路径
  GET  /v1/workspace/tree      获取文件树（供前端文件树组件渲染）
  GET  /v1/workspace/file      读取文件内容（供编辑器加载）
  PUT  /v1/workspace/file      写入文件内容（供编辑器手动保存）
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import workspace_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspace", tags=["Workspace"])


# ── Schema ────────────────────────────────────────────────────────────────────

class OpenWorkspaceRequest(BaseModel):
    path: str   # 本地绝对路径或 ~ 开头的路径


class OpenWorkspaceResponse(BaseModel):
    root: str
    name: str   # 目录名（用于前端显示）


class WorkspaceInfoResponse(BaseModel):
    root: str | None
    name: str | None
    is_open: bool


class FileReadResponse(BaseModel):
    path: str
    content: str
    size: int
    lines: int


class FileWriteRequest(BaseModel):
    path: str
    content: str


class FileWriteResponse(BaseModel):
    path: str
    size: int
    lines: int


# ── 接口实现 ──────────────────────────────────────────────────────────────────

@router.get("/locate")
async def locate_workspace(name: str = Query(..., description="文件夹名称")):
    """
    在本机常见目录下搜索与 name 匹配的文件夹，返回候选完整路径列表。
    前端用于在 File System Access API 只能拿到文件夹名时，自动推断完整路径。
    """
    home = Path.home()

    # 收集所有候选搜索根（容器内 home 可能是 /root，需额外扫描挂载的宿主机目录）
    search_roots: list[Path] = []

    # 1. 容器自身 home 及其常见子目录
    for sub in ["", "projects", "Projects", "workspace", "Workspace",
                "dev", "Dev", "code", "Code", "repos", "Repos", "src",
                "Documents", "Desktop"]:
        p = home / sub if sub else home
        search_roots.append(p)

    # 2. 挂载的宿主机 /Users（macOS）或 /home（Linux）下的所有用户目录
    for users_root in [Path("/Users"), Path("/home")]:
        if users_root.is_dir():
            try:
                for user_dir in users_root.iterdir():
                    if not user_dir.is_dir():
                        continue
                    for sub in ["", "projects", "Projects", "workspace", "Workspace",
                                "dev", "Dev", "code", "Code", "repos", "Repos", "src",
                                "Documents", "Desktop"]:
                        p = user_dir / sub if sub else user_dir
                        search_roots.append(p)
            except PermissionError:
                pass

    # 3. 其他常见系统路径
    search_roots += [Path("/opt"), Path("/srv")]

    candidates: list[str] = []
    seen: set[str] = set()

    for root in search_roots:
        if not root.is_dir():
            continue
        # 直接子目录匹配（深度 1）
        try:
            direct = root / name
            if direct.is_dir():
                s = str(direct)
                if s not in seen:
                    seen.add(s)
                    candidates.append(s)
        except PermissionError:
            continue
        # 再搜一层（深度 2），避免太慢只搜一层
        try:
            for sub in root.iterdir():
                if not sub.is_dir():
                    continue
                try:
                    candidate = sub / name
                    if candidate.is_dir():
                        s = str(candidate)
                        if s not in seen:
                            seen.add(s)
                            candidates.append(s)
                except PermissionError:
                    continue
        except PermissionError:
            continue

    return {"name": name, "candidates": candidates}


@router.post("/open", response_model=OpenWorkspaceResponse)
async def open_workspace(body: OpenWorkspaceRequest):
    """
    打开本地工作区。
    接收本地目录路径，验证存在后设为 workspace_root。
    后续所有文件操作都限制在此目录内。
    """
    try:
        root = workspace_service.set_workspace(body.path)
        return OpenWorkspaceResponse(root=str(root), name=root.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("open_workspace failed | path=%s error=%s", body.path, e)
        raise HTTPException(status_code=500, detail=f"打开工作区失败：{e}")


@router.get("/info", response_model=WorkspaceInfoResponse)
async def get_workspace_info():
    """获取当前工作区信息。"""
    root = workspace_service.get_workspace()
    if root is None:
        return WorkspaceInfoResponse(root=None, name=None, is_open=False)
    return WorkspaceInfoResponse(root=str(root), name=root.name, is_open=True)


@router.get("/tree")
async def get_file_tree(path: str = Query(default="", description="子目录路径，留空则返回根目录")):
    """
    获取工作区文件树。
    返回 JSON 格式的目录树，供前端文件树组件渲染。
    """
    try:
        root = workspace_service.require_workspace()
        if path:
            target = workspace_service.resolve_path(path)
            if not target.is_dir():
                raise HTTPException(status_code=400, detail=f"{path} 不是目录")
        else:
            target = root

        tree = workspace_service.build_file_tree(target)
        return {
            "root": str(root),
            "path": path or "/",
            "tree": tree,
        }
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/file", response_model=FileReadResponse)
async def read_file(
    path: str = Query(..., description="文件路径（相对于工作区根目录）"),
):
    """
    读取工作区内指定文件的内容。
    供前端编辑器加载文件使用（非 Agent MCP 工具）。
    """
    try:
        file_path = workspace_service.resolve_path(path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"文件不存在：{path}")
        if not file_path.is_file():
            raise HTTPException(status_code=400, detail=f"{path} 不是文件")

        content = file_path.read_text(encoding="utf-8", errors="replace")
        lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
        return FileReadResponse(
            path=path,
            content=content,
            size=file_path.stat().st_size,
            lines=lines,
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("read_file api failed | path=%s error=%s", path, e)
        raise HTTPException(status_code=500, detail=f"读取文件失败：{e}")


@router.put("/file", response_model=FileWriteResponse)
async def write_file(body: FileWriteRequest):
    """
    写入工作区内指定文件的内容。
    供前端编辑器手动保存（Cmd+S）使用（非 Agent MCP 工具）。
    """
    try:
        file_path = workspace_service.resolve_path(body.path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(body.content, encoding="utf-8")
        lines = body.content.count("\n") + (1 if body.content and not body.content.endswith("\n") else 0)
        size = file_path.stat().st_size
        logger.info("write_file api | path=%s lines=%d size=%d", body.path, lines, size)
        return FileWriteResponse(path=body.path, size=size, lines=lines)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error("write_file api failed | path=%s error=%s", body.path, e)
        raise HTTPException(status_code=500, detail=f"写入文件失败：{e}")
