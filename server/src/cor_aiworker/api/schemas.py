"""请求与响应模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..kernel.types import Risk


class _FromRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProviderOut(BaseModel):
    name: str
    protocol: str
    default_model: str
    has_key: bool  # 只告诉界面「是否已配置」，永远不返回 Key 本身


class ApiKeyIn(BaseModel):
    key: str = Field(min_length=1, max_length=4096)


class SessionCreate(BaseModel):
    provider: str
    model: str | None = Field(default=None, max_length=200)
    title: str = Field(default="", max_length=200)


class SessionUpdate(BaseModel):
    title: str = Field(max_length=200)


class SessionOut(_FromRecord):
    id: str
    title: str
    provider: str
    model: str
    created_at: str
    updated_at: str


class SessionDetail(SessionOut):
    active_run_id: str | None


class RunCreate(BaseModel):
    input: str = Field(min_length=1, max_length=100_000)


class RunAccepted(BaseModel):
    run_id: str


class RunOut(_FromRecord):
    id: str
    session_id: str
    status: str
    user_input: str
    stop: str | None
    error: str | None
    turns: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    started_at: str
    finished_at: str | None


class ApprovalIn(BaseModel):
    approved: bool


class ToolOut(BaseModel):
    name: str
    description: str
    risk: Risk
    untrusted: bool
    policy: str | None  # 按工具覆盖的策略；None 表示使用按风险等级的默认策略


class ToolPolicyIn(BaseModel):
    decision: Literal["allow", "ask", "deny"]
