from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.schemas.chat import AgentDeductionConfig
from app.services import discussion_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/discussion", tags=["Discussion"])


class DiscussionRequest(BaseModel):
    """POST /v1/discussion 请求体（研讨会模式）。"""
    topic: str = Field(..., description="推演议题")
    agents: list[AgentDeductionConfig] = Field(..., description="参与推演的 Agent 列表（含组织者）")
    organizer_id: str = Field(..., description="组织者 Agent ID，负责最终总结")
    discussion_rounds: int = Field(2, ge=1, le=3, description="普通 Agent 讨论轮数（1-3，默认 2）")


@router.post(
    "",
    summary="研讨会模式多 Agent 推演",
    description=(
        "研讨会模式：Agent 之间主动交流，组织者最终总结。\n\n"
        "**流程：**\n"
        "1. Round 1：所有非组织者 Agent 并行独立发言（给出初步观点）\n"
        "2. Round 2：每个 Agent 读取所有人的 Round 1 发言，进行回应/辩论\n"
        "3. Final：组织者读取所有轮次的全部发言，输出最终综合结论\n\n"
        "**SSE 事件类型：**\n"
        "- `discussion_round_start`：一轮开始，携带 `round`（1/2/0=组织者）和 `agent_ids`\n"
        "- `agent_start`：普通 Agent 开始发言，携带 `round`\n"
        "- `delta`：普通 Agent 输出增量，携带 `round`\n"
        "- `agent_done`：普通 Agent 完成，携带 `full_text` 和 `round`\n"
        "- `agent_error`：普通 Agent 出错，携带 `message` 和 `round`\n"
        "- `organizer_start`：组织者开始总结\n"
        "- `organizer_delta`：组织者输出增量\n"
        "- `organizer_done`：组织者完成，携带 `full_text`\n"
        "- `all_done`：全部完成"
    ),
    response_class=StreamingResponse,
)
async def discussion(body: DiscussionRequest) -> StreamingResponse:
    logger.info(
        "POST /v1/discussion | agents=%d organizer=%s rounds=%d topic=%s",
        len(body.agents),
        body.organizer_id,
        body.discussion_rounds,
        body.topic[:40],
    )
    return StreamingResponse(
        discussion_service.stream_discussion(
            topic=body.topic,
            agents=body.agents,
            organizer_id=body.organizer_id,
            discussion_rounds=body.discussion_rounds,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
