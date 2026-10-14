"""Skills API — Skill 的 CRUD 接口。

路由前缀：/v1/skills
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.services import skill_store
from app.tools import skill_runner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["Skills"])


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────

class SkillFileIn(BaseModel):
    filename: str
    content: str


class CreateSkillRequest(BaseModel):
    name: str
    description: str = ""
    skill_type: str = "custom"
    tags: list[str] = []
    files: list[SkillFileIn] = []


class UpdateSkillRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    skill_type: str | None = None
    tags: list[str] | None = None
    enabled: bool | None = None


class UpsertFileRequest(BaseModel):
    filename: str
    content: str


# ── 路由 ──────────────────────────────────────────────────────────────────────

@router.get("", summary="列出所有 Skill")
async def list_skills(enabled_only: bool = False) -> dict:
    skills = skill_store.list_skills(enabled_only=enabled_only)
    return {
        "skills": [s.to_dict(include_files=True) for s in skills],
        "total": len(skills),
    }


@router.get("/{skill_id}", summary="获取 Skill 详情（含文件内容）")
async def get_skill(skill_id: str) -> dict:
    skill = skill_store.get_skill(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    return skill.to_dict(include_files=True)


@router.post("", summary="创建新 Skill", status_code=201)
async def create_skill(body: CreateSkillRequest) -> dict:
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Skill 名称不能为空")
    skill = skill_store.create_skill(
        name=body.name.strip(),
        description=body.description,
        skill_type=body.skill_type,
        tags=body.tags,
        files=[{"filename": f.filename, "content": f.content} for f in body.files],
    )
    logger.info("POST /v1/skills | created id=%s name=%s", skill.id, skill.name)
    return skill.to_dict(include_files=True)


@router.patch("/{skill_id}", summary="更新 Skill 元数据")
async def update_skill(skill_id: str, body: UpdateSkillRequest) -> dict:
    skill = skill_store.update_skill(
        skill_id=skill_id,
        name=body.name,
        description=body.description,
        skill_type=body.skill_type,
        tags=body.tags,
        enabled=body.enabled,
    )
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")

    # 动态注册/注销 tool_registry
    if body.enabled is not None and skill.skill_type != "builtin":
        py_sources = [f.content for f in skill.files if f.language == "python"]
        if body.enabled and py_sources:
            skill_runner.register_skill_as_tool(
                skill_id=skill.id,
                skill_name=skill.name,
                description=skill.description,
                py_sources=py_sources,
            )
        elif not body.enabled:
            skill_runner.unregister_skill_tool(skill.id, skill.name)

    return skill.to_dict(include_files=True)


@router.delete("/{skill_id}", summary="删除 Skill")
async def delete_skill(skill_id: str) -> dict:
    deleted = skill_store.delete_skill(skill_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    return {"success": True, "id": skill_id}


# ── 文件管理 ──────────────────────────────────────────────────────────────────

@router.put("/{skill_id}/files", summary="新增或更新 Skill 文件")
async def upsert_file(skill_id: str, body: UpsertFileRequest) -> dict:
    sf = skill_store.upsert_skill_file(skill_id, body.filename, body.content)
    if sf is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    return sf.to_dict()


@router.delete("/{skill_id}/files/{file_id}", summary="删除 Skill 文件")
async def delete_file(skill_id: str, file_id: str) -> dict:
    deleted = skill_store.delete_skill_file(skill_id, file_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="文件不存在")
    return {"success": True, "file_id": file_id}


@router.post("/{skill_id}/files/upload", summary="上传文件到 Skill（multipart）")
async def upload_file(
    skill_id: str,
    file: UploadFile = File(...),
) -> dict:
    """支持直接上传 .py / .md 等文件。"""
    content_bytes = await file.read()
    try:
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="文件必须是 UTF-8 编码的文本文件")

    filename = file.filename or "untitled.txt"
    sf = skill_store.upsert_skill_file(skill_id, filename, content)
    if sf is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    return sf.to_dict()
