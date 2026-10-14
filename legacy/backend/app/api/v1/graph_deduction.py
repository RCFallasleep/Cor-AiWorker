from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.chat import GraphDeductionRequest
from app.services import graph_deduction_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/graph-deduction", tags=["GraphDeduction"])


@router.post(
    "",
    summary="图结构多 Agent 推演（方案 C）",
    description=(
        "按组织阶段生成的 edges 有向图调度 Agent 推演顺序。\n\n"
        "- `edge: from → to` 表示 from 的输出会注入 to 的上下文（to 依赖 from）\n"
        "- 入度为 0 的 Agent 立即并行启动\n"
        "- 某 Agent 完成后，其下游 Agent 收到上游输出后再启动\n"
        "- 若 edges 存在环，自动降级为简单并行模式\n\n"
        "SSE 事件类型：\n"
        "- `round_start`：一轮 Agent 开始，携带 `round` 和 `agent_ids`\n"
        "- `agent_start`：单个 Agent 开始推演\n"
        "- `delta`：Agent 输出文字增量\n"
        "- `agent_done`：Agent 推演完成，携带 `full_text`\n"
        "- `agent_error`：Agent 推演出错，携带 `message`\n"
        "- `agent_waiting`：Agent 等待上游完成，携带 `waiting_for`（上游 ID 列表）\n"
        "- `all_done`：所有 Agent 均已完成"
    ),
    response_class=StreamingResponse,
)
async def graph_deduction(body: GraphDeductionRequest) -> StreamingResponse:
    logger.info(
        "POST /v1/graph-deduction | agents=%d edges=%d topic=%s",
        len(body.agents),
        len(body.edges),
        body.topic[:40],
    )
    return StreamingResponse(
        graph_deduction_service.stream_graph_deduction(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
