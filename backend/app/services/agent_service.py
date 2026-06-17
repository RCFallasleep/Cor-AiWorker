from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncGenerator
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import openai

from app.schemas.chat import ChatRequest, ClientContext
from app.services import log_store
from app.tools.registry import tool_registry

logger = logging.getLogger(__name__)

# Agent 最大自循环次数，防止无限循环
MAX_LOOP_COUNT = 10


def _sse(payload: dict) -> str:
    """将字典序列化为 SSE 事件字符串。"""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_agent(body: ChatRequest) -> AsyncGenerator[str, None]:
    """Agent 自循环编排入口。

    流程（每轮均为真正流式）：
    1. 携带 tools 列表以 stream=True 调用模型
    2. 实时推送模型输出的文字 delta
       - 中间轮次（有 tool_call）→ thinking_delta 事件（前端展示思考过程）
       - 最终轮次（无 tool_call）→ delta 事件（前端展示最终回复）
    3. 同时在内存中拼接 tool_call 的 JSON 片段
    4. 收到 finish_reason=tool_calls → 执行工具 → 继续下一轮
    5. 收到 finish_reason=stop → 推 done → 退出

    关键设计：
    - 每个 chunk 到来时，若已出现 tool_call chunk，则后续文字推 thinking_delta；
      否则推 delta（乐观假设为最终轮）。
    - 若最终 finish_reason=tool_calls，前端收到的 delta 会被重新归类为 thinking_delta
      （通过 round_type 信号通知前端）。
    - 最简实现：实时推 thinking_delta，最终轮推 delta，两者前端分开渲染。

    SSE 事件类型：
    - {"type": "thinking_delta", "content": "..."}          中间轮次思考文字（实时流式）
    - {"type": "delta",          "content": "..."}          最终回复文字（实时流式）
    - {"type": "tool_call",      "name": "...", "args": {}} 工具调用开始
    - {"type": "tool_result",    "name": "...", "content": "..."} 工具执行结果
    - {"type": "done",           "input_tokens": N, "output_tokens": N}
    - {"type": "error",          "message": "..."}
    """
    try:
        # Bedrock / Vertex AI 原生协议不支持 Function Calling，降级为普通 chat
        if body.provider == "bedrock":
            logger.info("agent: bedrock protocol detected, fallback to plain chat (no tool calling)")
            from app.services.chat_service import _stream_bedrock  # 避免循环导入
            async for chunk in _stream_bedrock(body):
                yield chunk
            return
        if body.provider == "vertex":
            logger.info("agent: vertex protocol detected, fallback to plain chat (no tool calling)")
            from app.services.chat_service import _stream_vertex  # 避免循环导入
            async for chunk in _stream_vertex(body):
                yield chunk
            return

        async for chunk in _agent_loop_openai(body):
            yield chunk
    except Exception as exc:
        logger.error("agent stream error | %s", exc, exc_info=True)
        yield _sse({"type": "error", "message": str(exc)})


async def _agent_loop_openai(body: ChatRequest) -> AsyncGenerator[str, None]:
    """基于 OpenAI 兼容协议的 Agent 自循环（每轮真正流式）。

    流式 tool_call 拼接原理：
    OpenAI 流式返回时，tool_call 的 name/arguments 分散在多个 chunk 里：
        chunk1: delta.tool_calls[0].index=0, .function.name="web_search"
        chunk2: delta.tool_calls[0].index=0, .function.arguments='{"q'
        chunk3: delta.tool_calls[0].index=0, .function.arguments='uery": "上海天气"}'
    我们用 tool_calls_acc[index] 字典逐步拼接，finish_reason=tool_calls 时拼接完毕。

    文字 delta 实时推送策略：
    - 收到第一个 tool_call chunk 之前：乐观推 delta（假设是最终轮）
    - 收到第一个 tool_call chunk 之后：改推 thinking_delta
    - 若最终 finish_reason=stop（确认是最终轮）：之前推的 delta 就是最终回复，无需处理
    - 若最终 finish_reason=tool_calls（确认是思考轮）：
        之前乐观推出的 delta 需要"撤回"并重推为 thinking_delta。
        但 SSE 无法撤回，所以改用以下策略：
        → 收到任何 tool_call chunk 时，立刻推 {"type": "reclassify", "from": "delta", "to": "thinking_delta"}
          前端收到后把本轮已渲染的 delta 内容移入思考区。
    """
    client = openai.AsyncOpenAI(
        api_key=body.api_key,
        base_url=body.base_url or None,
        default_headers=body.extra_headers or None,
    )

    # 构建初始消息列表
    messages: list[dict] = [m.model_dump() for m in body.messages]

    # 注入静态上下文（时间 + 位置）到 system 消息
    context_hint = _build_context_hint(body.context)
    if context_hint:
        has_system = any(m.get("role") == "system" for m in messages)
        if has_system:
            for m in messages:
                if m.get("role") == "system":
                    m["content"] = m["content"].rstrip() + f"\n\n{context_hint}"
                    break
        else:
            messages.insert(0, {"role": "system", "content": context_hint})

    # 获取工具列表（按 tool_names 白名单过滤）
    if body.tool_names is None:
        # 未指定：使用全部已注册工具
        tools = tool_registry.to_openai_schemas()
    elif len(body.tool_names) == 0:
        # 空列表：禁用所有工具，降级为普通 chat
        tools = []
    else:
        # 白名单过滤：只保留指定名称的工具
        tools = [
            t.to_openai_schema()
            for t in tool_registry.all()
            if t.name in body.tool_names
        ]
        logger.info(
            "agent: tool_names filter applied | requested=%s available=%s",
            body.tool_names,
            [t["function"]["name"] for t in tools],
        )

    if not tools:
        logger.info("no tools available, fallback to plain chat")
        from app.services.chat_service import _stream_openai  # 避免循环导入
        async for chunk in _stream_openai(body):
            yield chunk
        return

    total_input_tokens = 0
    total_output_tokens = 0

    # ── 提取用户最后一条消息，用于日志记录 ──
    user_query = ""
    for m in reversed(messages):
        if m.get("role") == "user":
            user_query = str(m.get("content", ""))[:200]
            break

    # ── 创建本次执行的日志记录 ──
    run_log = log_store.create_run(
        session_id=body.session_id or "unknown",
        model=body.model,
        user_query=user_query,
    )
    run_start_ms = time.monotonic()

    # ── 连续重复工具调用检测 ──
    # 记录上一轮调用的工具名集合，连续相同超过阈值时强制注入打断消息
    _MAX_SAME_TOOL_REPEAT = 2   # 同一工具连续调用超过此次数触发打断
    _last_tool_names: list[str] = []   # 上一轮的工具名列表
    _same_tool_repeat_count = 0        # 连续重复计数

    for loop_index in range(MAX_LOOP_COUNT):
        logger.debug("agent loop | round=%d/%d", loop_index + 1, MAX_LOOP_COUNT)

        round_start_ms = time.monotonic()
        round_log = log_store.AgentRoundLog(
            round_index=loop_index + 1,
            started_at=datetime.now(),
        )

        stream = await client.chat.completions.create(
            model=body.model,
            messages=messages,      # type: ignore[arg-type]
            tools=tools,            # type: ignore[arg-type]
            tool_choice="auto",
            stream=True,
            # stream_options 部分模型（如 DeepSeek）不支持，不传此参数
            # token 用量通过最后一个 chunk 的 usage 字段读取
        )

        # ── 本轮状态 ──
        full_text = ""                      # 本轮模型输出的文字
        tool_calls_acc: dict[int, dict] = {}  # index → {id, name, arguments_buf}
        finish_reason: str | None = None
        # 是否已确认本轮为思考轮（出现过 tool_call chunk）
        is_thinking_round = False
        # 是否已向前端发送过 reclassify 信号
        reclassify_sent = False
        round_input_tokens = 0
        round_output_tokens = 0

        async for chunk in stream:
            # 累计 token 用量
            if chunk.usage:
                round_input_tokens = chunk.usage.prompt_tokens or 0
                round_output_tokens = chunk.usage.completion_tokens or 0
                total_input_tokens += round_input_tokens
                total_output_tokens += round_output_tokens

            if not chunk.choices:
                continue

            choice = chunk.choices[0]
            delta = choice.delta
            if choice.finish_reason:
                finish_reason = choice.finish_reason

            # ── 处理 tool_call chunk ──
            if delta.tool_calls:
                # 第一次出现 tool_call chunk：确认本轮是思考轮
                if not is_thinking_round:
                    is_thinking_round = True
                    # 通知前端：把本轮已推出的 delta 重新归类为 thinking_delta
                    if full_text and not reclassify_sent:
                        yield _sse({"type": "reclassify", "from": "delta", "to": "thinking_delta"})
                        reclassify_sent = True

                for tc_delta in delta.tool_calls:
                    idx = tc_delta.index
                    if idx not in tool_calls_acc:
                        tool_calls_acc[idx] = {
                            "id":            tc_delta.id or "",
                            "name":          (tc_delta.function.name or "") if tc_delta.function else "",
                            "arguments_buf": "",
                        }
                    else:
                        if tc_delta.id:
                            tool_calls_acc[idx]["id"] = tc_delta.id
                        if tc_delta.function and tc_delta.function.name:
                            tool_calls_acc[idx]["name"] += tc_delta.function.name

                    if tc_delta.function and tc_delta.function.arguments:
                        tool_calls_acc[idx]["arguments_buf"] += tc_delta.function.arguments

            # ── 处理文字 delta（实时推送）──
            if delta.content:
                full_text += delta.content
                # 根据当前是否已确认为思考轮，决定事件类型
                event_type = "thinking_delta" if is_thinking_round else "delta"
                yield _sse({"type": event_type, "content": delta.content})

        # ── 流结束，记录本轮日志 ──
        round_duration_ms = int((time.monotonic() - round_start_ms) * 1000)
        round_log.duration_ms = round_duration_ms
        round_log.input_tokens = round_input_tokens
        round_log.output_tokens = round_output_tokens
        round_log.finish_reason = finish_reason or ""
        round_log.thinking_text = full_text[:500] if is_thinking_round else ""

        if finish_reason == "stop" or not tool_calls_acc:
            # 最终回复轮：文字已实时推完（delta 事件），直接推 done
            logger.debug("agent loop done | round=%d final reply streamed", loop_index + 1)

            # 记录最终轮日志并持久化
            run_log.rounds.append(round_log)
            run_log.total_rounds = loop_index + 1
            run_log.total_input_tokens = total_input_tokens
            run_log.total_output_tokens = total_output_tokens
            run_log.total_duration_ms = int((time.monotonic() - run_start_ms) * 1000)
            run_log.status = "done"
            run_log.finished_at = datetime.now()
            await log_store.finish_run(run_log)

            yield _sse({
                "type":          "done",
                "input_tokens":  total_input_tokens,
                "output_tokens": total_output_tokens,
            })
            return

        # finish_reason == "tool_calls"：思考轮结束，执行工具

        # 把 assistant 消息（含 tool_calls）追加到历史
        tool_calls_for_msg = [
            {
                "id":       acc["id"],
                "type":     "function",
                "function": {
                    "name":      acc["name"],
                    "arguments": acc["arguments_buf"],
                },
            }
            for acc in tool_calls_acc.values()
        ]
        messages.append({
            "role":       "assistant",
            "content":    full_text or None,
            "tool_calls": tool_calls_for_msg,
        })

        # 执行每个工具，并记录工具调用日志
        for acc in tool_calls_acc.values():
            tool_name = acc["name"]
            try:
                tool_args = json.loads(acc["arguments_buf"] or "{}")
            except json.JSONDecodeError:
                tool_args = {}

            logger.info("agent tool_call | name=%s args=%s", tool_name, tool_args)

            yield _sse({
                "type": "tool_call",
                "name": tool_name,
                "args": tool_args,
            })

            tool_start_ms = time.monotonic()
            tool_success = True
            try:
                tool_result = await tool_registry.execute(tool_name, tool_args)
            except Exception as tool_exc:
                tool_result = f"[工具执行失败] {tool_exc}"
                tool_success = False

            tool_duration_ms = int((time.monotonic() - tool_start_ms) * 1000)

            logger.info(
                "agent tool_result | name=%s duration_ms=%d result_len=%d",
                tool_name, tool_duration_ms, len(tool_result),
            )

            # 记录工具调用日志
            round_log.tool_calls.append(log_store.ToolCallLog(
                name=tool_name,
                args=tool_args,
                result_preview=tool_result[:300],
                duration_ms=tool_duration_ms,
                success=tool_success,
            ))

            yield _sse({
                "type":    "tool_result",
                "name":    tool_name,
                "content": tool_result,
            })

            messages.append({
                "role":         "tool",
                "tool_call_id": acc["id"],
                "content":      tool_result,
            })

        # 本轮（思考轮）日志追加
        run_log.rounds.append(round_log)

        # ── 连续重复工具调用检测 ──
        current_tool_names = sorted(acc["name"] for acc in tool_calls_acc.values())
        if current_tool_names == sorted(_last_tool_names) and current_tool_names:
            _same_tool_repeat_count += 1
        else:
            _same_tool_repeat_count = 0
        _last_tool_names = current_tool_names

        if _same_tool_repeat_count >= _MAX_SAME_TOOL_REPEAT:
            # 连续重复超过阈值：注入强制打断消息，让模型基于已有信息直接回答
            tool_names_str = "、".join(set(current_tool_names))
            interrupt_msg = (
                f"[系统提示] 工具「{tool_names_str}」已连续调用 {_same_tool_repeat_count + 1} 次，"
                "搜索结果可能已足够。请基于以上已获取的信息，直接给出最终回答，不要再调用工具。"
            )
            logger.warning(
                "agent loop: same tool repeated %d times | tools=%s | injecting interrupt",
                _same_tool_repeat_count + 1, current_tool_names,
            )
            messages.append({"role": "user", "content": interrupt_msg})
            _same_tool_repeat_count = 0   # 重置计数，避免每轮都注入

    # ── 超出最大循环次数 ──
    logger.warning("agent loop exceeded max rounds | max=%d", MAX_LOOP_COUNT)

    run_log.total_rounds = MAX_LOOP_COUNT
    run_log.total_input_tokens = total_input_tokens
    run_log.total_output_tokens = total_output_tokens
    run_log.total_duration_ms = int((time.monotonic() - run_start_ms) * 1000)
    run_log.status = "error"
    run_log.error_message = f"超出最大循环次数（{MAX_LOOP_COUNT} 轮）"
    run_log.finished_at = datetime.now()
    await log_store.finish_run(run_log)

    yield _sse({
        "type":    "delta",
        "content": f"\n\n[Agent 已达最大循环次数（{MAX_LOOP_COUNT} 轮），强制终止。]",
    })
    yield _sse({
        "type":          "done",
        "input_tokens":  total_input_tokens,
        "output_tokens": total_output_tokens,
    })


def _build_context_hint(ctx: ClientContext | None) -> str:
    """根据客户端上下文构建注入到 system 消息的提示文本。"""
    lines: list[str] = []

    tz_name = (ctx.timezone if ctx else None) or "Asia/Shanghai"
    try:
        tz = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("Asia/Shanghai")
        tz_name = "Asia/Shanghai"

    now = datetime.now(tz=tz)
    weekday_cn = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    now_str = now.strftime(f"%Y年%m月%d日 {weekday_cn[now.weekday()]} %H:%M")
    lines.append(f"当前日期时间：{now_str}（{tz_name}）。请以此作为「今天」的基准，不要使用训练数据中的日期。")

    if ctx and ctx.city:
        lines.append(f"用户当前所在城市：{ctx.city}。当用户说「这里」「附近」「本地」时，以此城市为准。")

    return "\n".join(lines)
