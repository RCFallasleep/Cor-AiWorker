from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.chat import ChatRequest
from app.services import agent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["Agent"])


@router.post(
    "/chat",
    summary="Agent 自循环 Chat 接口",
    description=(
        "携带 Tool 注册表调用模型，支持 Function Calling 自循环编排。\n\n"
        "SSE 事件类型：\n"
        "- `delta`：文字增量（最终回复）\n"
        "- `tool_call`：工具调用开始（含工具名和参数）\n"
        "- `tool_result`：工具执行结果\n"
        "- `done`：完成（含 token 用量）\n"
        "- `error`：错误信息"
    ),
    response_class=StreamingResponse,
)
async def agent_chat(body: ChatRequest) -> StreamingResponse:
    """路由层只做参数接收与响应包装，业务逻辑全部在 agent_service 中。"""
    logger.info("POST /v1/agent/chat | model=%s", body.model)
    return StreamingResponse(
        agent_service.stream_agent(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
