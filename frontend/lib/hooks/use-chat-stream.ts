"use client";

/**
 * useChatStream
 * 接收完整的模型信息（来自 useAvailableModels），
 * 支持两种模式：
 *   - 普通 Chat：调用 /v1/chat，一问一答
 *   - Agent Chat：调用 /v1/agent/chat，支持 Function Calling 自循环
 *
 * 调用目标优先级：
 *   1. 环境变量 NEXT_PUBLIC_BACKEND_URL 指定的后端地址（FastAPI）
 *   2. 回退到 Next.js 自身的 /api/chat（仅普通 Chat 模式）
 *
 * SSE 事件类型（Agent 模式）：
 *   - delta          最终回复文字增量（实时流式）
 *   - thinking_delta 中间轮次思考文字增量（实时流式）
 *   - reclassify     将本轮已推出的 delta 重新归类为 thinking_delta
 *   - tool_call      工具调用开始
 *   - tool_result    工具执行结果
 *   - done           流式结束（含 token 用量）
 *   - error          错误
 */

import { useState, useCallback, useRef } from "react";
import type { ChatMessage } from "@/lib/mock-chat-data";
import type { AvailableModel } from "@/lib/hooks/use-available-models";
import type { ClientContext } from "@/lib/hooks/use-client-context";

/** 图片附件（base64 data URL） */
export interface ImageAttachment {
  id: string;
  name: string;
  type: "image";
  preview: string; // base64 data URL
}

export type Attachment = ImageAttachment;

export interface StreamState {
  streaming: boolean;
  error: string | null;
}

/** Agent 工具调用中间状态 */
export interface ToolCallEvent {
  type: "tool_call";
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  name: string;
  content: string;
}

/**
 * reclassify 事件：后端确认本轮为思考轮后，通知前端把已渲染的 delta 移入思考区。
 * 场景：模型先输出文字再输出 tool_call，前端已乐观渲染为 delta，需要重新归类。
 */
export interface ReclassifyEvent {
  type: "reclassify";
  from: "delta";
  to: "thinking_delta";
}

export type AgentEvent = ToolCallEvent | ToolResultEvent | ReclassifyEvent;

/** 后端 FastAPI 地址，未配置时回退到 Next.js 内置路由 */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

/** 根据模式和是否配置后端，决定调用目标 */
function getEndpoint(agentMode: boolean): string {
  if (BACKEND_URL) {
    return agentMode ? `${BACKEND_URL}/v1/agent/chat` : `${BACKEND_URL}/v1/chat`;
  }
  return "/api/chat"; // 回退：仅支持普通 chat
}

/** 将附件 + 文字组合成 OpenAI vision 格式的 content */
function buildUserContent(
  text: string,
  attachments: Attachment[],
): string | Array<{ type: string; [k: string]: unknown }> {
  const images = attachments.filter((a) => a.type === "image") as ImageAttachment[];
  if (images.length === 0) return text;

  const parts: Array<{ type: string; [k: string]: unknown }> = [];
  for (const img of images) {
    parts.push({
      type: "image_url",
      image_url: { url: img.preview, detail: "auto" },
    });
  }
  if (text.trim()) {
    parts.push({ type: "text", text });
  }
  return parts;
}

/** 统一构造请求 body，兼容后端（snake_case）与内置路由（camelCase）两种格式 */
function buildRequestBody(
  model: AvailableModel,
  messages: { role: "user" | "assistant"; content: string }[],
  context?: ClientContext,
  sessionId?: string | null,
  systemPrompt?: string,
  /** 当前用户消息的附件（图片等），用于替换最后一条 user 消息的 content */
  attachments?: Attachment[],
): string {
  // 如果有 Agent system prompt，注入为第一条 system 消息
  const baseMessages: { role: string; content: unknown }[] = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : [...messages];

  // 最后一条 user 消息如果有图片附件，替换为多模态 content
  if (attachments && attachments.length > 0) {
    const lastIdx = baseMessages.length - 1;
    if (lastIdx >= 0 && baseMessages[lastIdx].role === "user") {
      const lastContent = baseMessages[lastIdx].content as string;
      baseMessages[lastIdx] = {
        role: "user",
        content: buildUserContent(lastContent, attachments),
      };
    }
  }

  if (BACKEND_URL) {
    return JSON.stringify({
      messages: baseMessages,
      model: model.apiName,
      api_key: model.keyValue,
      base_url: model.baseUrl ?? null,
      extra_headers: model.keyRecord.extraHeaders ?? null,
      provider: model.keyRecord.provider,
      context: context ?? null,
      session_id: sessionId ?? null,
    });
  }
  return JSON.stringify({
    messages: baseMessages,
    model: model.apiName,
    apiKey: model.keyValue,
    baseUrl: model.baseUrl,
    extraHeaders: model.keyRecord.extraHeaders,
    provider: model.keyRecord.provider,
  });
}

export function useChatStream() {
  const [state, setState] = useState<StreamState>({ streaming: false, error: null });
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      model: AvailableModel,
      history: ChatMessage[],
      userContent: string,
      onDelta: (delta: string) => void,
      onDone: (inputTokens: number, outputTokens: number) => void,
      onError: (msg: string) => void,
      onAgentEvent?: (event: AgentEvent) => void,
      /** 中间轮次思考文字增量回调（区别于最终回复的 onDelta） */
      onThinkingDelta?: (delta: string) => void,
      agentMode: boolean = true,
      context?: ClientContext,
      /** 前端会话 ID，用于后端日志关联 */
      sessionId?: string | null,
      /** Agent 的 system prompt，注入为第一条 system 消息 */
      systemPrompt?: string,
      /** 当前消息的图片附件 */
      attachments?: Attachment[],
    ) => {
      setState({ streaming: true, error: null });

      const messages = [
        ...history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: userContent },
      ];

      abortRef.current = new AbortController();
      try {
        const endpoint = getEndpoint(agentMode);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: buildRequestBody(model, messages, context, sessionId, systemPrompt, attachments),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? data.detail ?? `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("无法读取响应流");

        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const event = JSON.parse(raw);

              if (event.type === "delta") {
                // 最终回复文字增量
                onDelta(event.content);
              } else if (event.type === "thinking_delta") {
                // 中间轮次思考文字增量
                onThinkingDelta?.(event.content);
              } else if (event.type === "reclassify") {
                // 后端确认本轮为思考轮：通知前端把已渲染的 delta 移入思考区
                onAgentEvent?.(event as ReclassifyEvent);
              } else if (event.type === "done") {
                onDone(
                  event.input_tokens ?? event.inputTokens ?? 0,
                  event.output_tokens ?? event.outputTokens ?? 0
                );
              } else if (event.type === "tool_call" || event.type === "tool_result") {
                onAgentEvent?.(event as AgentEvent);
              } else if (event.type === "error") {
                throw new Error(event.message);
              }
            } catch (parseErr) {
              // JSON 解析失败时忽略（可能是不完整的 chunk）
            }
          }
        }

        setState({ streaming: false, error: null });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setState({ streaming: false, error: null });
          return;
        }
        const msg = err instanceof Error ? err.message : "请求失败";
        setState({ streaming: false, error: msg });
        onError(msg);
      }
    },
    []
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { ...state, sendMessage, abort };
}
