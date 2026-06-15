from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.chat import DeductionRequest
from app.services import deduction_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/deduction", tags=["Deduction"])


@router.post(
    "",
    summary="多 Agent 并行推演",
    description=(
        "所有 Agent 同时启动，各自针对议题进行流式推演。\n\n"
        "SSE 事件类型（均含 `agent_id` 字段）：\n"
        "- `agent_start`：Agent 开始推演\n"
        "- `delta`：Agent 输出文字增量\n"
        "- `agent_done`：Agent 推演完成，携带 `full_text`\n"
        "- `agent_error`：Agent 推演出错，携带 `message`\n"
        "- `all_done`：所有 Agent 均已完成"
    ),
    response_class=StreamingResponse,
)
async def deduction(body: DeductionRequest) -> StreamingResponse:
    logger.info(
        "POST /v1/deduction | agents=%d topic=%s",
        len(body.agents),
        body.topic[:40],
    )
    return StreamingResponse(
        deduction_service.stream_deduction(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
