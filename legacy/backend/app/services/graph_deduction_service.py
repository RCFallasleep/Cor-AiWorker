"""graph_deduction_service.py — 方案 C：图结构消息传递推演服务。

核心思路：
  - 按组织阶段生成的 edges（有向图）决定 Agent 启动顺序
  - edge: from → to 表示 from 的输出会注入 to 的上下文（to 依赖 from）
  - 入度为 0 的 Agent 立即并行启动
  - 某 Agent 完成后，检查其下游 Agent 的所有依赖是否就绪，就绪则启动
  - 最终推送 all_done 事件

SSE 事件类型（均含 agent_id 字段，除 all_done 外）：
  - {"type": "round_start",    "round": 1, "agent_ids": [...]}
  - {"type": "agent_start",    "agent_id": "...", "name": "...", "role": "..."}
  - {"type": "delta",          "agent_id": "...", "content": "..."}
  - {"type": "agent_done",     "agent_id": "...", "full_text": "..."}
  - {"type": "agent_error",    "agent_id": "...", "message": "..."}
  - {"type": "agent_waiting",  "agent_id": "...", "waiting_for": [...]}
  - {"type": "all_done"}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections import defaultdict
from collections.abc import AsyncGenerator

import openai

from app.schemas.chat import AgentDeductionConfig, GraphDeductionRequest

logger = logging.getLogger(__name__)

# 单个 Agent 推演超时（秒）
AGENT_TIMEOUT_SECONDS = 120


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def detect_cycle(agent_ids: list[str], edges: list[tuple[str, str]]) -> bool:
    """DFS 检测有向图是否存在环。

    Args:
        agent_ids: 所有节点 ID 列表
        edges: (from_id, to_id) 元组列表，表示 from 的输出流向 to

    Returns:
        True 表示存在环，False 表示无环（DAG）
    """
    # 构建邻接表（from → [to, ...]）
    adj: dict[str, list[str]] = defaultdict(list)
    for from_id, to_id in edges:
        adj[from_id].append(to_id)

    # 0=未访问, 1=访问中（在当前 DFS 路径上）, 2=已完成
    state: dict[str, int] = {aid: 0 for aid in agent_ids}

    def dfs(node: str) -> bool:
        if state[node] == 1:
            return True   # 发现环
        if state[node] == 2:
            return False  # 已处理，无环
        state[node] = 1
        for neighbor in adj.get(node, []):
            if dfs(neighbor):
                return True
        state[node] = 2
        return False

    return any(dfs(aid) for aid in agent_ids if state[aid] == 0)


def _build_agent_messages(
    agent: AgentDeductionConfig,
    topic: str,
    upstream_outputs: list[dict],  # [{"name": str, "role": str, "output": str}]
) -> list[dict]:
    """为单个 Agent 构建推演消息列表，注入上游输出作为上下文。"""
    parts: list[str] = []

    if agent.system_prompt:
        parts.append(agent.system_prompt.strip())

    if agent.role:
        parts.append(f"\n## 你在本次推演中的职位\n{agent.role}")

    if agent.task_prompt:
        parts.append(f"\n## 你的具体任务\n{agent.task_prompt}")
    else:
        parts.append(
            "\n## 你的任务\n请针对以下议题，从你的专业视角进行深入分析，给出你的观点和建议。"
        )

    system_content = "\n".join(parts)

    # 构建用户消息：议题 + 上游输出（如有）
    user_parts: list[str] = [f"议题：{topic}\n"]

    if upstream_outputs:
        user_parts.append("\n## 参考信息（来自上游协作者的分析）\n")
        for up in upstream_outputs:
            user_parts.append(
                f"### {up['name']}（{up['role']}）的分析：\n{up['output']}\n"
            )
        user_parts.append(
            "\n请基于以上参考信息和你的职位任务，给出你的分析与结论。"
            "要求：逻辑清晰、有理有据、结论明确，300-600字。"
        )
    else:
        user_parts.append(
            "请基于你的职位和任务，给出你的分析与结论。"
            "要求：逻辑清晰、有理有据、结论明确，300-500字。"
        )

    return [
        {"role": "system", "content": system_content},
        {"role": "user",   "content": "".join(user_parts)},
    ]


# ── 核心图调度器 ──────────────────────────────────────────────────────────────

async def stream_graph_deduction(
    request: GraphDeductionRequest,
) -> AsyncGenerator[str, None]:
    """图结构推演入口。

    按 edges 有向图拓扑顺序调度 Agent，下游 Agent 收到上游输出后再启动。
    若 edges 存在环或为空，降级为简单并行模式。
    """
    if not request.agents:
        yield _sse({"type": "all_done"})
        return

    agent_ids = [a.id for a in request.agents]
    agent_map: dict[str, AgentDeductionConfig] = {a.id: a for a in request.agents}

    # ── 解析 edges ──
    raw_edges: list[tuple[str, str]] = [
        (e.from_id, e.to_id) for e in request.edges
        if e.from_id in agent_map and e.to_id in agent_map
    ]

    # 环检测：有环则降级为并行
    has_cycle = detect_cycle(agent_ids, raw_edges) if raw_edges else False
    if has_cycle:
        logger.warning("graph_deduction: cycle detected in edges, falling back to parallel mode")
        raw_edges = []

    # ── 构建图结构 ──
    # dependents[A] = [B, C]  → A 完成后，B、C 可能可以启动
    # dependencies[B] = [A]   → B 需要等 A 完成
    dependents:   dict[str, list[str]] = defaultdict(list)
    dependencies: dict[str, list[str]] = defaultdict(list)

    for from_id, to_id in raw_edges:
        dependents[from_id].append(to_id)
        dependencies[to_id].append(from_id)

    # 计算入度（依赖数量）
    in_degree: dict[str, int] = {aid: len(dependencies[aid]) for aid in agent_ids}

    # ── 共享状态 ──
    agent_outputs: dict[str, str] = {}          # agent_id → 完整输出文本
    sse_queue: asyncio.Queue[str | None] = asyncio.Queue()
    done_count = 0
    total = len(agent_ids)
    lock = asyncio.Lock()

    # 按轮次分组（入度为 0 的是第 1 轮，依此类推）
    # 用于 round_start 事件
    round_map: dict[str, int] = {}
    _queue: list[str] = [aid for aid in agent_ids if in_degree[aid] == 0]
    _visited: set[str] = set(_queue)
    _round = 1
    _current_round_ids = list(_queue)
    for aid in _current_round_ids:
        round_map[aid] = _round

    # BFS 计算每个节点的轮次（仅用于 round_start 事件，不影响调度）
    _bfs_queue = list(_current_round_ids)
    while _bfs_queue:
        _next: list[str] = []
        for aid in _bfs_queue:
            for dep_id in dependents[aid]:
                if dep_id not in _visited:
                    _visited.add(dep_id)
                    _next.append(dep_id)
                    round_map[dep_id] = round_map[aid] + 1
        _bfs_queue = _next

    # ── Agent 执行协程 ──
    async def run_agent(agent_id: str) -> None:
        nonlocal done_count
        agent = agent_map[agent_id]

        async def put(payload: dict) -> None:
            await sse_queue.put(_sse({**payload, "agent_id": agent_id}))

        try:
            # 收集上游输出
            upstream_outputs = [
                {
                    "name": agent_map[dep_id].name,
                    "role": agent_map[dep_id].role,
                    "output": agent_outputs[dep_id],
                }
                for dep_id in dependencies[agent_id]
                if dep_id in agent_outputs
            ]

            api_key = agent.api_key or os.environ.get("OPENAI_API_KEY", "")
            client = openai.AsyncOpenAI(
                api_key=api_key,
                base_url=agent.base_url or None,
                default_headers=agent.extra_headers or {},
            )

            messages = _build_agent_messages(agent, request.topic, upstream_outputs)

            await put({"type": "agent_start", "name": agent.name, "role": agent.role})

            stream = await asyncio.wait_for(
                client.chat.completions.create(
                    model=agent.model,
                    messages=messages,  # type: ignore[arg-type]
                    temperature=0.7,
                    stream=True,
                ),
                timeout=AGENT_TIMEOUT_SECONDS,
            )

            full_text = ""
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    full_text += delta.content
                    await put({"type": "delta", "content": delta.content})

            await put({"type": "agent_done", "full_text": full_text})

            # 保存输出，触发下游调度
            async with lock:
                agent_outputs[agent_id] = full_text
                done_count += 1

                # 检查下游 Agent 是否所有依赖都已就绪
                for next_id in dependents[agent_id]:
                    remaining = [
                        dep for dep in dependencies[next_id]
                        if dep not in agent_outputs
                    ]
                    if not remaining:
                        # 所有依赖就绪，启动下游 Agent
                        asyncio.create_task(run_agent(next_id))
                    else:
                        # 还有依赖未完成，发送 waiting 事件
                        await sse_queue.put(_sse({
                            "type": "agent_waiting",
                            "agent_id": next_id,
                            "waiting_for": remaining,
                        }))

                if done_count >= total:
                    await sse_queue.put(None)  # 结束信号

        except asyncio.TimeoutError:
            logger.warning("graph_deduction: agent %s timed out", agent_id)
            await put({"type": "agent_error", "message": f"推演超时（>{AGENT_TIMEOUT_SECONDS}s）"})
            async with lock:
                agent_outputs[agent_id] = ""  # 超时也视为完成，避免下游永久等待
                done_count += 1
                for next_id in dependents[agent_id]:
                    remaining = [dep for dep in dependencies[next_id] if dep not in agent_outputs]
                    if not remaining:
                        asyncio.create_task(run_agent(next_id))
                if done_count >= total:
                    await sse_queue.put(None)

        except openai.APIError as e:
            logger.error("graph_deduction: agent %s API error | %s", agent_id, e)
            await put({"type": "agent_error", "message": f"API 错误：{e}"})
            async with lock:
                agent_outputs[agent_id] = ""
                done_count += 1
                for next_id in dependents[agent_id]:
                    remaining = [dep for dep in dependencies[next_id] if dep not in agent_outputs]
                    if not remaining:
                        asyncio.create_task(run_agent(next_id))
                if done_count >= total:
                    await sse_queue.put(None)

        except Exception as e:
            logger.error("graph_deduction: agent %s unexpected error | %s", agent_id, e, exc_info=True)
            await put({"type": "agent_error", "message": str(e)})
            async with lock:
                agent_outputs[agent_id] = ""
                done_count += 1
                for next_id in dependents[agent_id]:
                    remaining = [dep for dep in dependencies[next_id] if dep not in agent_outputs]
                    if not remaining:
                        asyncio.create_task(run_agent(next_id))
                if done_count >= total:
                    await sse_queue.put(None)

    # ── 启动入度为 0 的 Agent（第 1 轮） ──
    first_round_ids = [aid for aid in agent_ids if in_degree[aid] == 0]

    if not first_round_ids:
        # 所有节点都有依赖（理论上不应发生，因为已做环检测）
        logger.error("graph_deduction: no root nodes found, aborting")
        yield _sse({"type": "all_done"})
        return

    # 推送第 1 轮开始事件
    yield _sse({"type": "round_start", "round": 1, "agent_ids": first_round_ids})

    # 对于有依赖的 Agent，提前推送 waiting 事件（让前端知道它们在等待）
    for aid in agent_ids:
        if in_degree[aid] > 0:
            yield _sse({
                "type": "agent_waiting",
                "agent_id": aid,
                "waiting_for": list(dependencies[aid]),
            })

    # 并行启动第 1 轮
    for aid in first_round_ids:
        asyncio.create_task(run_agent(aid))

    # ── 消费 SSE 队列 ──
    while True:
        item = await sse_queue.get()
        if item is None:
            break
        yield item

    yield _sse({"type": "all_done"})
