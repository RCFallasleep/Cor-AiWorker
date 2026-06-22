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
MAX_LOOP_COUNT = 15

# ── 模型上下文窗口大小映射表 ──
# 未知模型默认 128000（保守估计）
MODEL_CONTEXT_LIMITS: dict[str, int] = {
    # OpenAI
    "gpt-4o":                  128_000,
    "gpt-4o-mini":             128_000,
    "gpt-4-turbo":             128_000,
    "gpt-4":                    8_192,
    "gpt-3.5-turbo":           16_385,
    "o1":                      200_000,
    "o1-mini":                 128_000,
    "o3-mini":                 200_000,
    # Anthropic Claude
    "claude-3-5-sonnet-20241022": 200_000,
    "claude-3-5-haiku-20241022":  200_000,
    "claude-3-opus-20240229":     200_000,
    "claude-3-sonnet-20240229":   200_000,
    "claude-3-haiku-20240307":    200_000,
    "claude-opus-4-5":            200_000,
    "claude-sonnet-4-5":          200_000,
    # DeepSeek
    "deepseek-chat":            64_000,
    "deepseek-reasoner":        64_000,
    # Gemini
    "gemini-1.5-pro":        1_000_000,
    "gemini-1.5-flash":      1_000_000,
    "gemini-2.0-flash":      1_000_000,
    # Qwen
    "qwen-long":               500_000,
    "qwen-turbo":              131_072,
    "qwen-plus":               131_072,
    "qwen-max":                 32_768,
}

def _get_context_limit(model: str) -> int:
    """从模型名推断上下文窗口大小，支持前缀匹配。"""
    if model in MODEL_CONTEXT_LIMITS:
        return MODEL_CONTEXT_LIMITS[model]
    # 前缀匹配（如 gpt-4o-2024-11-20 → gpt-4o）
    for key, limit in MODEL_CONTEXT_LIMITS.items():
        if model.startswith(key):
            return limit
    return 128_000  # 默认保守值


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


async def _compress_messages(
    messages: list[dict],
    body: ChatRequest,
) -> tuple[list[dict], int, int]:
    """用当前 LLM 对历史 tool 消息做智能摘要压缩。

    压缩策略（按优先级）：
    1. 永远保留：system 消息、user 消息、最近 3 轮的所有消息
    2. 优先压缩：早期 tool 角色消息（内容最长，信息密度最低）
    3. 次之压缩：早期 assistant 思考轮文字（中间过程）

    返回：(压缩后的 messages, 压缩前 token 估算, 压缩后 token 估算)
    """
    client = openai.AsyncOpenAI(
        api_key=body.api_key,
        base_url=body.base_url or None,
        default_headers=body.extra_headers or None,
    )

    # 找出最近 3 轮的边界（保留最近 3 个 assistant 消息及其后续）
    assistant_indices = [i for i, m in enumerate(messages) if m.get("role") == "assistant"]
    keep_from = assistant_indices[-3] if len(assistant_indices) >= 3 else 0

    tokens_before = sum(len(str(m.get("content", ""))) for m in messages) // 3
    compressed_count = 0

    new_messages = []
    for i, msg in enumerate(messages):
        role = msg.get("role", "")
        content = msg.get("content", "") or ""

        # 保留区域：system / user / 最近 3 轮 → 不压缩
        if role in ("system", "user") or i >= keep_from:
            new_messages.append(msg)
            continue

        # tool 消息：内容超过 500 字才值得压缩
        if role == "tool" and len(content) > 500:
            try:
                resp = await client.chat.completions.create(
                    model=body.model,
                    messages=[{
                        "role": "user",
                        "content": (
                            "请将以下工具执行结果压缩为简洁摘要，要求：\n"
                            "1. 保留所有关键数据、数字、结论、URL\n"
                            "2. 去除冗余描述、重复内容、HTML标签残留\n"
                            "3. 用简洁的中文输出，不超过 800 字\n\n"
                            f"工具结果：\n{content}"
                        ),
                    }],
                    max_tokens=1000,
                    stream=False,
                )
                summary = resp.choices[0].message.content or content[:800]
                new_msg = dict(msg)
                new_msg["content"] = f"[已压缩摘要]\n{summary}"
                new_messages.append(new_msg)
                compressed_count += 1
                logger.info(
                    "compress: tool msg compressed | original=%d chars → %d chars",
                    len(content), len(summary),
                )
            except Exception as e:
                logger.warning("compress: failed to compress tool msg | %s", e)
                # 压缩失败降级：截断前 800 字
                new_msg = dict(msg)
                new_msg["content"] = content[:800] + f"\n[压缩失败，已截断，原始长度 {len(content)} 字]"
                new_messages.append(new_msg)

        # assistant 思考轮文字：超过 300 字才压缩
        elif role == "assistant" and len(content) > 300 and not msg.get("tool_calls"):
            try:
                resp = await client.chat.completions.create(
                    model=body.model,
                    messages=[{
                        "role": "user",
                        "content": (
                            "请将以下 AI 思考过程压缩为一句话摘要（不超过 100 字）：\n\n"
                            f"{content}"
                        ),
                    }],
                    max_tokens=150,
                    stream=False,
                )
                summary = resp.choices[0].message.content or content[:100]
                new_msg = dict(msg)
                new_msg["content"] = f"[思考摘要] {summary}"
                new_messages.append(new_msg)
                compressed_count += 1
            except Exception as e:
                logger.warning("compress: failed to compress assistant msg | %s", e)
                new_messages.append(msg)
        else:
            new_messages.append(msg)

    tokens_after = sum(len(str(m.get("content", ""))) for m in new_messages) // 3
    logger.info(
        "compress: done | compressed=%d msgs | tokens %d → %d (freed ~%d)",
        compressed_count, tokens_before, tokens_after, tokens_before - tokens_after,
    )
    return new_messages, tokens_before, tokens_after


async def _agent_loop_openai(body: ChatRequest) -> AsyncGenerator[str, None]:
    """基于 OpenAI 兼容协议的 Agent 自循环（每轮真正流式）。

    流式 tool_call 拼接原理：
    OpenAI 流式返回时，tool_call 的 name/arguments 分散在多个 chunk 里：
        chunk1: delta.tool_calls[0].index=0, .function.name="web_search"
        chunk2: delta.tool_calls[0].index=0, .function.arguments='{"q'
        chunk3: delta.tool_calls[0].index=0, .function.arguments='uery": "上海天气"}'
    我们用 tool_calls_acc[index] 字典逐步拼接，finish_reason=tool_calls 时拼接完毕。

    文字 delta 推送策略（缓冲策略，无 reclassify）：
    - 收到第一个 tool_call chunk 之前：将文字缓冲到 pre_tool_buf，暂不推送
    - 收到第一个 tool_call chunk 时：确认本轮是思考轮，将 pre_tool_buf 作为 thinking_delta 推出
    - 思考轮后续文字：直接推 thinking_delta
    - 若最终 finish_reason=stop（确认是最终轮）：
        将 pre_tool_buf 一次性推为 delta，然后继续流式推后续文字为 delta
    - 这样前端永远不会收到需要"撤回"的 delta，消除文字消失问题

    上下文压缩策略（两层触发）：
    - 第一层（主动）：每轮发送前检测 total_input_tokens / context_limit > 90%，触发压缩
    - 第二层（被动）：捕获 context_length_exceeded 异常，压缩后重试本轮
    """
    client = openai.AsyncOpenAI(
        api_key=body.api_key,
        base_url=body.base_url or None,
        default_headers=body.extra_headers or None,
    )

    context_limit = _get_context_limit(body.model)

    # ── compress_only 模式：只压缩，不跑 agent loop ──
    if getattr(body, "compress_only", False):
        async for chunk in _compress_only_mode(body, client, context_limit):
            yield chunk
        return

    # 构建初始消息列表
    messages: list[dict] = [m.model_dump() for m in body.messages]

    # 注入静态上下文（时间 + 位置）+ 可视化渲染能力提示 到 system 消息
    context_hint = _build_context_hint(body.context)
    system_additions = "\n\n".join(filter(None, [context_hint, _VISUALIZATION_HINT]))
    if system_additions:
        has_system = any(m.get("role") == "system" for m in messages)
        if has_system:
            for m in messages:
                if m.get("role") == "system":
                    m["content"] = m["content"].rstrip() + f"\n\n{system_additions}"
                    break
        else:
            messages.insert(0, {"role": "system", "content": system_additions})

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
    _MAX_SAME_TOOL_REPEAT = 2
    _last_tool_names: list[str] = []
    _same_tool_repeat_count = 0

    for loop_index in range(MAX_LOOP_COUNT):
        logger.debug("agent loop | round=%d/%d", loop_index + 1, MAX_LOOP_COUNT)

        # ── 第一层压缩触发：主动检测 90% 阈值 ──
        if total_input_tokens > 0 and total_input_tokens / context_limit > 0.90:
            logger.warning(
                "context usage %.1f%% > 90%%, triggering proactive compression | tokens=%d limit=%d",
                total_input_tokens / context_limit * 100, total_input_tokens, context_limit,
            )
            yield _sse({"type": "compressing", "message": "上下文占用超过 90%，正在智能压缩历史记录..."})
            messages, tokens_before, tokens_after = await _compress_messages(messages, body)
            freed = tokens_before - tokens_after
            yield _sse({
                "type": "compress_done",
                "freed_tokens": freed,
                "message": f"上下文压缩完成，释放约 {freed} tokens",
                "compressed_messages": _serialize_messages_for_frontend(messages),
            })

        round_start_ms = time.monotonic()
        round_log = log_store.AgentRoundLog(
            round_index=loop_index + 1,
            started_at=datetime.now(),
        )

        # ── 第二层压缩触发：捕获 context_length_exceeded 异常后重试 ──
        retry_after_compress = False
        try:
            stream = await client.chat.completions.create(
                model=body.model,
                messages=messages,      # type: ignore[arg-type]
                tools=tools,            # type: ignore[arg-type]
                tool_choice="auto",
                stream=True,
                max_tokens=16384,
            )
        except openai.BadRequestError as e:
            err_str = str(e).lower()
            if "context_length_exceeded" in err_str or "maximum context length" in err_str or "too many tokens" in err_str:
                logger.warning("context_length_exceeded caught, triggering fallback compression | %s", e)
                yield _sse({"type": "compressing", "message": "上下文超限，正在智能压缩后重试..."})
                messages, tokens_before, tokens_after = await _compress_messages(messages, body)
                freed = tokens_before - tokens_after
                yield _sse({
                    "type": "compress_done",
                    "freed_tokens": freed,
                    "message": f"压缩完成，释放约 {freed} tokens，正在重试...",
                    "compressed_messages": _serialize_messages_for_frontend(messages),
                })
                retry_after_compress = True
            else:
                raise

        if retry_after_compress:
            try:
                stream = await client.chat.completions.create(
                    model=body.model,
                    messages=messages,  # type: ignore[arg-type]
                    tools=tools,        # type: ignore[arg-type]
                    tool_choice="auto",
                    stream=True,
                    max_tokens=16384,
                )
            except Exception as retry_exc:
                logger.error("agent: retry after compress failed | %s", retry_exc)
                yield _sse({"type": "error", "message": f"压缩后重试失败：{retry_exc}"})
                return

        # ── 本轮状态 ──
        full_text = ""
        tool_calls_acc: dict[int, dict] = {}
        finish_reason: str | None = None
        is_thinking_round = False
        pre_tool_buf = ""
        pre_tool_flushed = False
        round_input_tokens = 0
        round_output_tokens = 0

        async for chunk in stream:
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

            if delta.tool_calls:
                if not is_thinking_round:
                    is_thinking_round = True
                    if pre_tool_buf and not pre_tool_flushed:
                        yield _sse({"type": "thinking_delta", "content": pre_tool_buf})
                        pre_tool_flushed = True

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

            if delta.content:
                full_text += delta.content
                if is_thinking_round:
                    yield _sse({"type": "thinking_delta", "content": delta.content})
                else:
                    pre_tool_buf += delta.content

        if not is_thinking_round and pre_tool_buf and not pre_tool_flushed:
            yield _sse({"type": "delta", "content": pre_tool_buf})
            pre_tool_flushed = True

        round_duration_ms = int((time.monotonic() - round_start_ms) * 1000)
        round_log.duration_ms = round_duration_ms
        round_log.input_tokens = round_input_tokens
        round_log.output_tokens = round_output_tokens
        round_log.finish_reason = finish_reason or ""
        round_log.thinking_text = full_text[:500] if is_thinking_round else ""

        if finish_reason == "stop" or not tool_calls_acc:
            logger.debug("agent loop done | round=%d final reply streamed", loop_index + 1)

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
                "context_limit": context_limit,
            })
            return

        # finish_reason == "tool_calls"：思考轮结束，执行工具
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

        for acc in tool_calls_acc.values():
            tool_name = acc["name"]
            try:
                tool_args = json.loads(acc["arguments_buf"] or "{}")
            except json.JSONDecodeError:
                tool_args = {}

            if tool_name == "browser_read":
                tool_args.setdefault("api_key", body.api_key or "")
                tool_args.setdefault("base_url", body.base_url or "")
                tool_args.setdefault("model", body.model or "gpt-4o-mini")

            if tool_name in ("create_scheduled_task", "list_scheduled_tasks", "cancel_scheduled_task"):
                if body.user_id:
                    tool_args.setdefault("user_id", body.user_id)
                if body.agent_self_id:
                    tool_args.setdefault("target_user_id", body.agent_self_id)

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

        run_log.rounds.append(round_log)

        current_tool_names = sorted(acc["name"] for acc in tool_calls_acc.values())
        if current_tool_names == sorted(_last_tool_names) and current_tool_names:
            _same_tool_repeat_count += 1
        else:
            _same_tool_repeat_count = 0
        _last_tool_names = current_tool_names

        if _same_tool_repeat_count >= _MAX_SAME_TOOL_REPEAT:
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
            _same_tool_repeat_count = 0

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
        "context_limit": context_limit,
    })


def _serialize_messages_for_frontend(messages: list[dict]) -> list[dict]:
    """将 messages 序列化为前端可用的格式（只保留 role + content，去掉 tool_calls 等复杂字段）。"""
    result = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content") or ""
        if role in ("user", "assistant", "tool", "system"):
            result.append({"role": role, "content": str(content)})
    return result


async def _compress_only_mode(
    body: ChatRequest,
    client: openai.AsyncOpenAI,
    context_limit: int,
) -> AsyncGenerator[str, None]:
    """compress_only 模式：只压缩 messages，不跑 agent loop。供手动压缩按钮调用。"""
    messages: list[dict] = [m.model_dump() for m in body.messages]

    yield _sse({"type": "compressing", "message": "正在智能压缩上下文历史记录..."})

    try:
        compressed, tokens_before, tokens_after = await _compress_messages(messages, body)
        freed = tokens_before - tokens_after
        yield _sse({
            "type": "compress_done",
            "freed_tokens": freed,
            "message": f"压缩完成，释放约 {freed} tokens",
            "compressed_messages": _serialize_messages_for_frontend(compressed),
        })
        yield _sse({
            "type":          "done",
            "input_tokens":  tokens_after,
            "output_tokens": 0,
            "context_limit": context_limit,
        })
    except Exception as e:
        logger.error("compress_only: failed | %s", e)
        yield _sse({"type": "error", "message": f"压缩失败：{e}"})


# ── 可视化渲染能力提示（注入到所有 Agent 的 system 消息）──
_VISUALIZATION_HINT = """
## 数据可视化能力

当用户需要图表、图形或可视化展示时，请使用以下代码块格式输出，前端会自动渲染为交互式预览：

### 【首选】ECharts 数据图表（折线图、柱状图、饼图、散点图等）
使用 ```echarts 代码块，内容为纯 JSON 格式的 ECharts option 对象：
```echarts
{
  "title": { "text": "示例图表" },
  "xAxis": { "data": ["A", "B", "C"] },
  "yAxis": {},
  "series": [{ "type": "bar", "data": [10, 20, 30] }]
}
```

### 【首选】Mermaid 流程图/时序图/架构图
使用 ```mermaid 代码块：
```mermaid
graph TD
  A[开始] --> B{判断}
  B -->|是| C[执行]
  B -->|否| D[结束]
```

### SVG 矢量图形（简单图形）
使用 ```svg 代码块，内容为完整 SVG 标签：
```svg
<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="100" fill="#6366f1" rx="8"/>
  <text x="100" y="55" text-anchor="middle" fill="white">示例</text>
</svg>
```

### 通用 HTML（仅用于简单文本/表格排版，不适合图表）
使用 ```html 代码块，内容为简短 HTML 片段（不超过 50 行）。

**重要规则**：
- 数据图表（折线、柱状、饼图、散点、雷达等）必须用 ECharts，禁止用 HTML + Chart.js/D3 等其他库
- 流程图、时序图、架构图、类图必须用 Mermaid
- 禁止生成包含完整 HTML 页面结构（<!DOCTYPE html>）的大型 HTML 文件，这会导致输出被截断
- ECharts option 必须是合法 JSON，不要包含注释、JavaScript 函数或箭头函数
- 数据来自 web_search 或 browser_read 时，整理后直接生成图表，无需用户再次确认
- 如需展示多个图表，可在一个 echarts 代码块中使用多个 series，或分多个代码块输出
""".strip()


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
