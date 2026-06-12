from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Message(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(..., description="消息角色")
    content: str = Field(..., description="消息内容")


class ClientContext(BaseModel):
    """前端可感知的静态上下文，随每次请求传入后端。"""
    timezone: str | None = Field(None, description="IANA 时区名，如 Asia/Shanghai")
    city: str | None = Field(None, description="用户所在城市，如 上海")
    latitude: float | None = Field(None, description="纬度（可选，用于更精确的位置服务）")
    longitude: float | None = Field(None, description="经度（可选）")


class ChatRequest(BaseModel):
    messages: list[Message] = Field(..., description="对话历史（不含当前用户消息）")
    model: str = Field(..., description="模型 ID，如 gpt-4o / claude-opus-4-5")
    api_key: str = Field(..., description="API Key，由前端从本地存储读取后传入")
    base_url: str | None = Field(None, description="自定义 Base URL（代理 / 转发地址）")
    context: ClientContext | None = Field(None, description="客户端静态上下文（时区、位置等）")
    session_id: str | None = Field(None, description="前端会话 ID，用于日志关联")


# ── SSE 事件结构（仅用于文档说明，实际以 JSON 字符串推送）──

class DeltaEvent(BaseModel):
    type: Literal["delta"] = "delta"
    content: str = Field(..., description="内容增量片段")


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    input_tokens: int = Field(0, description="输入 Token 数")
    output_tokens: int = Field(0, description="输出 Token 数")


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str = Field(..., description="错误信息")
