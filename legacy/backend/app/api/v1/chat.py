from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas.chat import ChatRequest
from app.services import chat_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.post(
    "",
    summary="流式 Chat 接口",
    description=(
        "接收对话历史与模型配置，以 SSE 格式流式返回 LLM 响应。\n\n"
        "协议自动识别：api_key 以 `sk-ant-` 开头 → Anthropic，其他 → OpenAI 兼容协议。"
    ),
    response_class=StreamingResponse,
)
async def chat(body: ChatRequest) -> StreamingResponse:
    """路由层只做参数接收与响应包装，业务逻辑全部在 chat_service 中。"""
    logger.info("POST /v1/chat | model=%s", body.model)
    return StreamingResponse(
        chat_service.stream_chat(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲，确保流式实时推送
        },
    )
