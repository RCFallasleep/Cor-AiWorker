"""
LiveBench 数据接口
GET /v1/livebench/scores?model=gpt-4o   → 返回六维分数
GET /v1/livebench/models                → 返回所有可用模型列表
POST /v1/livebench/refresh              → 强制刷新缓存
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import livebench_service

router = APIRouter(prefix="/livebench", tags=["LiveBench"])


class SkillScores(BaseModel):
    reasoning: float
    coding: float
    math: float
    writing: float
    research: float
    execution: float
    matched_model: str | None = None
    match_type: str = "exact"  # "exact" | "alias" | "approximate" | "default"


class ModelsResponse(BaseModel):
    models: list[str]
    total: int


class RefreshResponse(BaseModel):
    success: bool
    model_count: int


@router.get("/scores", response_model=SkillScores, summary="获取模型六维评测分数")
async def get_scores(
    model: str = Query(..., description="模型名称，支持模糊匹配，如 gpt-4o / claude-3.5-sonnet"),
) -> SkillScores:
    """
    从 LiveBench 数据中查询指定模型的六维能力分数。
    支持精确匹配、别名映射、近似匹配（去后缀）三级策略。
    未找到时返回默认分数（50分）而非 404，并通过 match_type="default" 标识。
    """
    result = await livebench_service.get_model_scores_with_meta(model)
    return SkillScores(**result)


@router.get("/models", response_model=ModelsResponse, summary="获取所有可用模型列表")
async def get_models() -> ModelsResponse:
    """返回 LiveBench 数据中所有模型名称。"""
    models = await livebench_service.list_models()
    return ModelsResponse(models=models, total=len(models))


@router.post("/refresh", response_model=RefreshResponse, summary="强制刷新 LiveBench 缓存")
async def force_refresh() -> RefreshResponse:
    """强制重新下载并解析最新 LiveBench CSV 数据。"""
    success = await livebench_service.refresh()
    models = await livebench_service.list_models()
    return RefreshResponse(success=success, model_count=len(models))
