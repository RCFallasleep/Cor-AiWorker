"use client";

/**
 * useChatStream
 * 接收完整的模型信息（来自 useAvailableModels），
 * 调用 /api/chat 流式接口，实时更新消息内容和 Token 用量。
 */

import { useState, useCallback, useRef } from "react";
import type { ChatMessage } from "@/lib/mock-chat-data";
import type { AvailableModel } from "@/lib/hooks/use-available-models";

export interface StreamState {
  streaming: boolean;
  error: string | null;
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
      onError: (msg: string) => void
    ) => {
      setState({ streaming: true, error: null });

      // 构建消息历史
      const messages = [
        ...history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: userContent },
      ];

      abortRef.current = new AbortController();
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            model: model.apiName,   // 模型名（用户填写）
            apiKey: model.keyValue, // Key 前缀自动决定协议，无需传 provider
            baseUrl: model.baseUrl,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        // 读取 SSE 流
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
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const event = JSON.parse(json);
              if (event.type === "delta") onDelta(event.content);
              else if (event.type === "done") onDone(event.inputTokens ?? 0, event.outputTokens ?? 0);
            } catch { /* 忽略解析错误 */ }
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
