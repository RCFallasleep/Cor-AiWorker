from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.chat import OrganizeRequest
from app.services import organize_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/organize", tags=["Organize"])


@router.get(
    "/templates",
    summary="获取组织者 Prompt 模版列表",
    description="返回内置的 Prompt 模版，前端用于模版选择下拉。",
)
async def get_templates() -> list[dict]:
    return organize_service.get_templates()


@router.post(
    "",
    summary="组织者 Agent 流式编排",
    description=(
        "组织者根据议题和参与 Agent 列表，流式输出团队架构规划。\n\n"
        "SSE 事件类型：\n"
        "- `thinking_delta`：组织者思考过程（实时流式文字）\n"
        "- `done`：组织完成，携带 `result`（OrganizeResult JSON）\n"
        "- `error`：错误信息"
    ),
    response_class=StreamingResponse,
)
async def organize(body: OrganizeRequest) -> StreamingResponse:
    logger.info(
        "POST /v1/organize | organizer=%s agents=%d topic=%s",
        body.organizer_id,
        len(body.agents),
        body.topic[:40],
    )
    return StreamingResponse(
        organize_service.stream_organize(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
