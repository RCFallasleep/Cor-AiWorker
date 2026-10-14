from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field


# ── 多模态 content 类型 ───────────────────────────────────────────────────────

class TextPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ImageUrlDetail(BaseModel):
    url: str                          # base64 data URL 或 https URL
    detail: str = "auto"              # "auto" | "low" | "high"


class ImageUrlPart(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: ImageUrlDetail


# content 可以是纯文本字符串，也可以是多模态 part 列表
MessageContent = Union[str, list[Union[TextPart, ImageUrlPart]]]


class Message(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(..., description="消息角色")
    content: MessageContent = Field(..., description="消息内容（纯文本或多模态 part 列表）")


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
    extra_headers: dict[str, str] | None = Field(None, description="额外 HTTP Header，用于企业网关自定义认证")
    provider: Literal["openai", "anthropic", "bedrock", "vertex"] | None = Field(
        None,
        description=(
            "调用协议：openai（OpenAI 兼容）/ anthropic（Anthropic SDK）/ bedrock（Bedrock 原生）/ vertex（Vertex AI Anthropic）。"
            "不传时由后端根据 api_key 前缀自动推断（sk-ant-* → anthropic，其他 → openai）。"
        ),
    )
    context: ClientContext | None = Field(None, description="客户端静态上下文（时区、位置等）")
    session_id: str | None = Field(None, description="前端会话 ID，用于日志关联")
    # 协作模块：当前登录用户 ID，用于 scheduler / forward_message 等工具注入
    user_id: str | None = Field(None, description="当前登录用户 ID（由前端从 JWT 解析后传入）")
    # 协作模块：Agent 助理的 user_id（即 target_user_id），用于定时任务提醒写入目标
    agent_self_id: str | None = Field(None, description="用户自己的 Agent 助理 user_id")
    tool_names: list[str] | None = Field(
        None,
        description=(
            "工具白名单：仅启用列表中的工具名。"
            "为 null 时使用全部已注册工具（Agent 对话场景）；"
            "传空列表 [] 时禁用所有工具（纯 Chat 场景）；"
            "传具体名称列表时只启用指定工具（Skill 中心场景）。"
        ),
    )
    compress_only: bool = Field(
        False,
        description=(
            "仅压缩模式：为 true 时只对 messages 做智能摘要压缩，不进入 agent loop。"
            "供前端手动压缩按钮调用，压缩完成后通过 SSE 返回 compress_done 事件（含压缩后的 messages）。"
        ),
    )
    max_loop_override: int | None = Field(
        None,
        description=(
            "覆盖默认最大循环次数（MAX_LOOP_COUNT）。"
            "用户点击「继续执行」时，前端传入更大的值（如 20、30），允许 Agent 继续工具调用。"
            "为 null 时使用默认值（15）。"
        ),
    )


# ── 组织阶段 Schemas ──────────────────────────────────────────────────────────

class AgentInfo(BaseModel):
    """前端传入的 Agent 基础信息（来自 IndexedDB）。"""
    id: str = Field(..., description="Agent ID")
    name: str = Field(..., description="Agent 名称")
    model: str = Field(..., description="Agent 使用的模型")
    system_prompt: str = Field("", description="Agent 原始 System Prompt")
    icon_color: str = Field("#6b7280", description="Agent 图标颜色")


class OrganizeRequest(BaseModel):
    """POST /v1/organize 请求体。"""
    topic: str = Field(..., description="议题内容")
    organizer_id: str = Field(..., description="组织者 Agent ID")
    agents: list[AgentInfo] = Field(..., description="参与推演的所有 Agent（含组织者）")
    organizer_prompt: str = Field("", description="组织者附加指令（可选，留空使用默认指令）")
    model: str = Field("gpt-4o", description="组织者使用的模型 ID")
    api_key: str = Field("", description="API Key（空时使用环境变量 OPENAI_API_KEY）")
    base_url: str | None = Field(None, description="自定义 Base URL")
    extra_headers: dict[str, str] | None = Field(None, description="额外 HTTP Header")
    provider: Literal["openai", "anthropic", "bedrock", "vertex"] | None = Field(None)


class OrganizeRole(BaseModel):
    """组织者为单个 Agent 分配的角色信息。"""
    agent_id: str = Field(..., description="Agent ID")
    role: str = Field(..., description="职位/角色名称，如「架构师」「安全审查员」")
    task_prompt: str = Field(..., description="该 Agent 的具体任务 Prompt")
    reports_to: str | None = Field(None, description="上级 Agent ID，null 表示直接汇报给组织者")


class OrganizeEdge(BaseModel):
    """Agent 之间的协作关系边。"""
    from_id: str = Field(..., alias="from", description="发起方 Agent ID")
    to_id: str = Field(..., alias="to", description="接收方 Agent ID")
    label: str = Field("", description="关系描述，如「指导」「协作」「汇报」")

    model_config = {"populate_by_name": True}


class OrganizeResult(BaseModel):
    """组织者输出的完整架构结果（嵌入 SSE done 事件）。"""
    roles: list[OrganizeRole] = Field(..., description="各 Agent 的角色分配")
    edges: list[OrganizeEdge] = Field(..., description="Agent 间协作关系图")


# ── 推演阶段 Schemas ──────────────────────────────────────────────────────────

class AgentDeductionConfig(BaseModel):
    """单个 Agent 的推演配置（来自组织阶段结果）。"""
    id: str = Field(..., description="Agent ID")
    name: str = Field(..., description="Agent 名称")
    model: str = Field(..., description="Agent 使用的模型")
    system_prompt: str = Field("", description="Agent 原始 System Prompt")
    role: str = Field("", description="组织阶段分配的职位/角色")
    task_prompt: str = Field("", description="组织阶段分配的具体任务 Prompt")
    api_key: str = Field("", description="该 Agent 使用的 API Key（空时用环境变量）")
    base_url: str | None = Field(None, description="自定义 Base URL")
    extra_headers: dict[str, str] | None = Field(None, description="额外 HTTP Header")


class DeductionRequest(BaseModel):
    """POST /v1/deduction 请求体（旧版：简单并行，无图结构）。"""
    topic: str = Field(..., description="推演议题")
    agents: list[AgentDeductionConfig] = Field(..., description="参与推演的 Agent 列表（含各自任务）")


class GraphEdge(BaseModel):
    """图结构推演中的有向边（来自组织阶段）。"""
    from_id: str = Field(..., alias="from", description="发起方 Agent ID（消息流出方）")
    to_id: str   = Field(..., alias="to",   description="接收方 Agent ID（消息流入方，依赖 from 的输出）")
    label: str   = Field("", description="关系描述，如「汇报」「协作」「指导」")

    model_config = {"populate_by_name": True}


class GraphDeductionRequest(BaseModel):
    """POST /v1/graph-deduction 请求体（方案 C：图结构消息传递）。"""
    topic: str = Field(..., description="推演议题")
    agents: list[AgentDeductionConfig] = Field(..., description="参与推演的 Agent 列表（含各自任务）")
    edges: list[GraphEdge] = Field(default_factory=list, description="Agent 间有向边（from → to 表示 from 的输出注入 to 的上下文）")


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
