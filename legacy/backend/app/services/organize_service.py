from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import AsyncGenerator

import openai

from app.schemas.chat import OrganizeRequest, OrganizeResult

logger = logging.getLogger(__name__)


# ── Prompt 模版 ───────────────────────────────────────────────────────────────

PROMPT_TEMPLATES: dict[str, dict[str, str]] = {
    "software_team": {
        "name": "软件开发团队",
        "prompt": (
            "你是一位经验丰富的技术负责人，负责为软件开发项目组建最优团队架构。\n"
            "你需要根据议题，为每位团队成员分配明确的技术职位（如架构师、后端工程师、"
            "前端工程师、安全审查员、测试工程师等），并制定各自的具体任务。\n"
            "确保职责清晰、分工合理，上下级关系体现技术决策链路。"
        ),
    },
    "research_team": {
        "name": "研究分析团队",
        "prompt": (
            "你是一位资深研究主任，负责组建跨学科研究团队。\n"
            "你需要根据研究议题，为每位成员分配研究方向（如文献综述、数据分析、"
            "实验设计、结论撰写、同行评审等），并明确各自的研究任务与协作关系。\n"
            "确保研究链路完整，上下级关系体现知识流向。"
        ),
    },
    "product_review": {
        "name": "产品评审团队",
        "prompt": (
            "你是一位产品委员会主席，负责组织产品方案评审。\n"
            "你需要根据评审议题，为每位成员分配评审角色（如产品经理、用户体验设计师、"
            "商业分析师、技术可行性评估员、风险评估员等），并明确各自的评审维度与任务。\n"
            "确保评审覆盖全面，上下级关系体现决策优先级。"
        ),
    },
    "strategy_team": {
        "name": "战略规划团队",
        "prompt": (
            "你是一位首席战略官，负责组建战略规划小组。\n"
            "你需要根据战略议题，为每位成员分配战略职能（如市场分析师、竞争情报官、"
            "财务规划师、运营优化师、风险管理师等），并明确各自的战略任务。\n"
            "确保战略视角多元，上下级关系体现战略决策层级。"
        ),
    },
}

# 组织者的核心指令（追加在用户 Prompt 之后，不可修改）
_ORGANIZE_INSTRUCTION = """

---
## 你的核心任务

当前参与推演的 Agent 列表如下：
{agent_list}

议题：{topic}

请根据议题和你的职责，为每位 Agent（不含你自己）分配：
1. 职位/角色名称
2. 具体任务 Prompt（该 Agent 在推演中需要完成的任务描述，100-200字）
3. 上级 Agent ID（reports_to，填写 agent_id；若直接汇报给你则填 null）
4. 协作关系边（from/to/label，描述 Agent 之间的信息流向）

**必须严格按照以下 JSON 格式输出，不要输出任何其他内容，不要用 markdown 代码块包裹：**

{{
  "roles": [
    {{
      "agent_id": "<agent_id>",
      "role": "<职位名称>",
      "task_prompt": "<具体任务描述>",
      "reports_to": "<上级agent_id 或 null>"
    }}
  ],
  "edges": [
    {{
      "from": "<agent_id>",
      "to": "<agent_id>",
      "label": "<关系描述>"
    }}
  ]
}}
"""


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _build_agent_list(request: OrganizeRequest) -> str:
    """构建 Agent 列表描述，注入到组织者 Prompt 中。"""
    lines = []
    for agent in request.agents:
        if agent.id == request.organizer_id:
            continue  # 组织者自己不在分配列表里
        lines.append(f"- ID: {agent.id} | 名称: {agent.name} | 模型: {agent.model}")
    return "\n".join(lines) if lines else "（无其他 Agent）"


def _extract_json(text: str) -> dict | None:
    """从 LLM 输出中提取 JSON，兼容 markdown 代码块包裹的情况。"""
    # 去掉 markdown 代码块
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    text = re.sub(r"```\s*$", "", text).strip()

    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取第一个 { ... } 块
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


async def stream_organize(request: OrganizeRequest) -> AsyncGenerator[str, None]:
    """组织者 Agent 流式编排入口。

    SSE 事件类型：
    - {"type": "thinking_delta", "content": "..."}   组织者思考过程（实时流式）
    - {"type": "done", "result": {...}}               组织完成，result 为 OrganizeResult JSON
    - {"type": "error", "message": "..."}             错误信息
    """
    try:
        # 构建组织者完整 System Prompt
        agent_list_str = _build_agent_list(request)
        instruction = _ORGANIZE_INSTRUCTION.format(
            agent_list=agent_list_str,
            topic=request.topic,
        )
        system_prompt = request.organizer_prompt + instruction

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"请开始为议题「{request.topic}」组建团队架构。"},
        ]

        # 推断 provider
        provider = request.provider
        if provider is None:
            provider = "anthropic" if (request.api_key or "").startswith("sk-ant-") else "openai"

        # api_key 为空时回退到环境变量
        api_key = request.api_key or os.environ.get("OPENAI_API_KEY", "")
        client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url=request.base_url or None,
            default_headers=request.extra_headers or {},
        )

        # 流式调用，收集完整输出
        full_text = ""
        stream = await client.chat.completions.create(
            model=request.model,
            messages=messages,  # type: ignore[arg-type]
            temperature=0.7,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                full_text += delta.content
                yield _sse({"type": "thinking_delta", "content": delta.content})

        # 解析 JSON 结果
        raw = _extract_json(full_text)
        if raw is None:
            yield _sse({"type": "error", "message": f"组织者输出无法解析为 JSON：{full_text[:200]}"})
            return

        try:
            result = OrganizeResult.model_validate(raw)
        except Exception as e:
            yield _sse({"type": "error", "message": f"JSON 结构校验失败：{e} | 原始：{full_text[:200]}"})
            return

        yield _sse({
            "type": "done",
            "result": result.model_dump(by_alias=True),
        })

    except openai.APIError as e:
        logger.error("organize: OpenAI API error | %s", e, exc_info=True)
        yield _sse({"type": "error", "message": f"API 调用失败：{e}"})
    except Exception as e:
        logger.error("organize: unexpected error | %s", e, exc_info=True)
        yield _sse({"type": "error", "message": str(e)})


def get_templates() -> list[dict]:
    """返回所有 Prompt 模版列表（供前端展示）。"""
    return [
        {"id": k, "name": v["name"], "prompt": v["prompt"]}
        for k, v in PROMPT_TEMPLATES.items()
    ]
