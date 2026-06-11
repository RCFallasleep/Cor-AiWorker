"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatToolbar } from "@/components/chat/chat-toolbar";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { useChatStream } from "@/lib/hooks/use-chat-stream";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { conversationRepo } from "@/lib/repositories/conversation-repository";
import { type ChatMessage } from "@/lib/mock-chat-data";
import type { AvailableModel } from "@/lib/hooks/use-available-models";
import type { ConversationRow } from "@/lib/db/idb";

/**
 * 异步调用 LLM 生成会话标题（非流式，静默执行，不影响主对话）
 * 让模型把用户第一条消息总结为 8 字以内的标题
 */
async function generateTitle(model: AvailableModel, userMessage: string): Promise<string> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `请将以下对话内容总结为一个简短的标题，要求：8个字以内，不加引号，不加标点，直接输出标题文字。\n\n对话内容：${userMessage}`,
          },
        ],
        model:   model.apiName,
        apiKey:  model.keyValue,
        baseUrl: model.baseUrl,
      }),
    });
    if (!res.ok || !res.body) return "";

    // 读取 SSE 流，拼接所有 delta
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let title  = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "delta") title += ev.content;
        } catch { /* 忽略 */ }
      }
    }

    // 清理：去掉引号、书名号、多余空格，截断到 20 字保险
    return title.replace(/["""《》「」『』]/g, "").trim().slice(0, 20) || "";
  } catch {
    return "";
  }
}

function nowTimestamp() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const urlConvId    = searchParams.get("id"); // 从 URL ?id= 读取

  const [modelId, setModelId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // 会话列表（用于下拉选择器）
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  // 当前会话 ID（null = 新对话，尚未创建）
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  // ref 同步当前会话 ID，供 handleSend 闭包使用
  const conversationIdRef = useRef<string | null>(null);
  // 标记是否已处理过 URL 参数（避免重复加载）
  const urlLoadedRef = useRef(false);

  const { models, loading: modelsLoading } = useAvailableModels();

  const effectiveModelId = modelId || models[0]?.id || "";
  const currentModel = models.find((m) => m.id === effectiveModelId);
  const supportsVision = currentModel?.supportsVision ?? false;

  const { streaming, sendMessage, abort } = useChatStream();

  // ── 切换会话：加载历史消息 ──
  const handleConversationChange = useCallback(async (id: string | null) => {
    setErrorBanner(null);
    setCurrentConvId(id);
    conversationIdRef.current = id;

    if (!id) {
      setMessages([]);
      return;
    }

    const rows = await conversationRepo.getMessages(id);
    const loaded: ChatMessage[] = rows.map((r) => ({
      id:        r.id,
      role:      r.role as "user" | "assistant",
      content:   r.content,
      timestamp: r.timestamp ?? "",
      username:  r.role === "user" ? "You" : undefined,
      meta:      r.meta as ChatMessage["meta"],
    }));
    setMessages(loaded);
  }, []);

  // ── 加载会话列表，并监听更新事件；列表就绪后处理 URL 参数 ──
  const refreshConversations = useCallback(async () => {
    const list = await conversationRepo.listConversations();
    setConversations(list);

    // 首次加载：如果 URL 带有 ?id= 且还没处理过，自动切换到该会话
    if (urlConvId && !urlLoadedRef.current) {
      const target = list.find((c) => c.id === urlConvId);
      if (target) {
        urlLoadedRef.current = true;
        setCurrentConvId(urlConvId);
        conversationIdRef.current = urlConvId;
        const rows = await conversationRepo.getMessages(urlConvId);
        const loaded: ChatMessage[] = rows.map((r) => ({
          id:        r.id,
          role:      r.role as "user" | "assistant",
          content:   r.content,
          timestamp: r.timestamp ?? "",
          username:  r.role === "user" ? "You" : undefined,
          meta:      r.meta as ChatMessage["meta"],
        }));
        setMessages(loaded);
      }
    }
  }, [urlConvId]);

  useEffect(() => {
    refreshConversations();
    window.addEventListener("conversation-updated", refreshConversations);
    return () => window.removeEventListener("conversation-updated", refreshConversations);
  }, [refreshConversations]);

  // 新建对话（清空消息，重置会话 ID）
  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setErrorBanner(null);
    setCurrentConvId(null);
    conversationIdRef.current = null;
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || streaming || !currentModel) return;
      setErrorBanner(null);

      const timestamp = nowTimestamp();

      // ── 1. 确保会话存在（首条消息时创建）──
      // 标题先用原文占位，流式结束后异步替换为 LLM 生成的标题
      const isFirstMessage = !conversationIdRef.current;
      if (isFirstMessage) {
        const conv = await conversationRepo.createConversation({
          title:      content.slice(0, 30) || "新对话",
          modelLabel: currentModel.label,
          modelKeyId: currentModel.id,
        });
        conversationIdRef.current = conv.id;
        setCurrentConvId(conv.id);
        // 通知会话列表刷新
        window.dispatchEvent(new CustomEvent("conversation-updated"));
      }
      // 此时 conversationIdRef.current 一定已赋值（上方 if 分支保证）
      const convId = conversationIdRef.current!;

      // ── 2. 写入用户消息到 IndexedDB ──
      const savedUserMsg = await conversationRepo.appendMessage({
        conversationId: convId,
        role:           "user",
        content,
        timestamp,
      });

      const userMsg: ChatMessage = {
        id:        savedUserMsg.id,
        role:      "user",
        content,
        timestamp,
        username:  "You",
      };

      // ── 3. 创建 assistant 占位消息（流式填充，暂不写 DB）──
      const assistantPlaceholderId = `msg-ai-${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id:        assistantPlaceholderId,
        role:      "assistant",
        content:   "",
        timestamp,
        meta: { model: currentModel.label, inputTokens: 0, outputTokens: 0, ctxPercent: 0 },
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // 用 ref 追踪流式内容，避免闭包问题
      let streamedContent = "";

      // ── 4. 流式请求 ──
      await sendMessage(
        currentModel,
        messages,
        content,
        // onDelta：实时追加内容
        (delta) => {
          streamedContent += delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantPlaceholderId
                ? { ...m, content: m.content + delta }
                : m
            )
          );
        },
        // onDone：流式结束，写入 DB，并异步生成标题
        async (inputTokens, outputTokens) => {
          const meta = {
            model:        currentModel.label,
            inputTokens,
            outputTokens,
            wordCount:    streamedContent.replace(/\s+/g, " ").split(" ").length,
            ctxPercent:   0,
          };

          // 更新 UI
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantPlaceholderId ? { ...m, meta } : m
            )
          );

          // 写入 IndexedDB
          const savedAssistant = await conversationRepo.appendMessage({
            conversationId: convId,
            role:           "assistant",
            content:        streamedContent,
            timestamp,
            meta,
          });

          // 用真实 DB id 替换占位 id
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantPlaceholderId ? { ...m, id: savedAssistant.id } : m
            )
          );

          // ── 首条消息：异步生成标题（不阻塞 UI）──
          if (isFirstMessage) {
            generateTitle(currentModel, content).then((title) => {
              if (title) {
                conversationRepo.updateConversation(convId, { title }).then(() => {
                  // 标题更新后再次通知侧边栏刷新
                  window.dispatchEvent(new CustomEvent("conversation-updated"));
                });
              }
            });
          }
        },
        // onError
        (errMsg) => {
          setErrorBanner(errMsg);
          setMessages((prev) => prev.filter((m) => m.id !== assistantPlaceholderId));
        }
      );
    },
    [messages, currentModel, sendMessage, streaming]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--background)",
      }}
    >
      {/* 顶部工具栏 */}
      <ChatToolbar
        conversationId={currentConvId}
        conversations={conversations}
        onConversationChange={handleConversationChange}
        modelId={effectiveModelId}
        onModelChange={(id) => { setModelId(id); setErrorBanner(null); }}
        streaming={streaming}
        onAbort={abort}
        onNewConversation={handleNewConversation}
      />

      {/* 错误提示横幅 */}
      {errorBanner && (
        <div
          style={{
            padding: "10px 20px",
            backgroundColor: "rgba(239,68,68,0.1)",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <span>{errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            style={{
              border: "none", backgroundColor: "transparent",
              color: "#ef4444", cursor: "pointer", fontSize: "16px",
              lineHeight: 1, outline: "none", flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* 空状态引导 */}
      {messages.length === 0 && !streaming && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            color: "var(--text-muted)",
          }}
        >
          <img src="/logo.svg" alt="logo" style={{ width: "56px", height: "56px", opacity: 0.4 }} />
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
            开始一段新对话
          </p>
          <p style={{ fontSize: "12px", margin: 0 }}>
            {modelsLoading
              ? "加载模型中..."
              : currentModel
              ? `当前模型：${currentModel.label}`
              : "请前往「设置 → API Key 管理」添加 Key"}
          </p>
        </div>
      )}

      {/* 消息列表 */}
      {messages.length > 0 && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <MessageList messages={messages} streaming={streaming} />
        </div>
      )}

      {/* 底部输入框 */}
      <ChatInput
        onSend={handleSend}
        disabled={streaming || !currentModel}
        supportsVision={supportsVision}
        placeholder={
          streaming ? "AI 正在回复..." :
          !currentModel ? "请先添加 API Key..." :
          "Message Assistant (Enter to send)"
        }
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
