"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatToolbar } from "@/components/chat/chat-toolbar";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { useChatStream, type AgentEvent } from "@/lib/hooks/use-chat-stream";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useClientContext } from "@/lib/hooks/use-client-context";
import { conversationRepo } from "@/lib/repositories/conversation-repository";
import { type ChatMessage, type AgentStep } from "@/lib/mock-chat-data";
import type { AvailableModel } from "@/lib/hooks/use-available-models";
import type { ConversationRow } from "@/lib/db/idb";

/** 后端地址（与 useChatStream 保持一致） */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

async function generateTitle(model: AvailableModel, userMessage: string): Promise<string> {
  try {
    const endpoint = BACKEND_URL ? `${BACKEND_URL}/v1/chat` : "/api/chat";
    const body = BACKEND_URL
      ? JSON.stringify({
          messages: [{ role: "user", content: `请将以下对话内容总结为一个简短的标题，要求：8个字以内，不加引号，不加标点，直接输出标题文字。\n\n对话内容：${userMessage}` }],
          model:    model.apiName,
          api_key:  model.keyValue,
          base_url: model.baseUrl ?? null,
        })
      : JSON.stringify({
          messages: [{ role: "user", content: `请将以下对话内容总结为一个简短的标题，要求：8个字以内，不加引号，不加标点，直接输出标题文字。\n\n对话内容：${userMessage}` }],
          model:   model.apiName,
          apiKey:  model.keyValue,
          baseUrl: model.baseUrl,
        });

    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok || !res.body) return "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let title = "", buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try { const ev = JSON.parse(line.slice(6)); if (ev.type === "delta") title += ev.content; } catch { /* 忽略 */ }
      }
    }
    return title.replace(/["""《》「」『』]/g, "").trim().slice(0, 20) || "";
  } catch { return ""; }
}

function nowTimestamp() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const urlConvId = searchParams.get("id");

  const [modelId, setModelId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const urlLoadedRef = useRef(false);

  const { models, loading: modelsLoading } = useAvailableModels();
  const effectiveModelId = modelId || models[0]?.id || "";
  const currentModel = models.find((m) => m.id === effectiveModelId);
  const supportsVision = currentModel?.supportsVision ?? false;

  const { streaming, sendMessage, abort } = useChatStream();
  const clientContext = useClientContext();

  // ── 当前 AI 占位消息 ID（供 Agent 事件回调更新 agentSteps）──
  const currentAiMsgIdRef = useRef<string | null>(null);
  // ── 当前轮次的思考文字缓冲（累积后写入最新 step 的 thinkingText）──
  const thinkingBufRef = useRef<string>("");
  // ── 当前 AI 消息的 agentSteps 实时镜像（供 onDone 读取最终值）──
  const agentStepsRef = useRef<AgentStep[]>([]);

  /** MessageRow → ChatMessage，恢复 agentSteps */
  const rowToMessage = useCallback((r: { id: string; role: string; content: string; timestamp?: string; meta?: { agentSteps?: AgentStep[]; [k: string]: unknown } }): ChatMessage => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    timestamp: r.timestamp ?? "",
    username: r.role === "user" ? "You" : undefined,
    meta: r.meta as ChatMessage["meta"],
    // 从 meta 里恢复 agentSteps（持久化时存在 meta.agentSteps）
    agentSteps: r.meta?.agentSteps ?? undefined,
  }), []);

  const handleConversationChange = useCallback(async (id: string | null) => {
    setErrorBanner(null);
    setCurrentConvId(id);
    conversationIdRef.current = id;
    if (!id) { setMessages([]); return; }
    const rows = await conversationRepo.getMessages(id);
    setMessages(rows.map(rowToMessage));
  }, [rowToMessage]);

  const refreshConversations = useCallback(async () => {
    const list = await conversationRepo.listConversations();
    setConversations(list);
    if (urlConvId && !urlLoadedRef.current) {
      const target = list.find((c) => c.id === urlConvId);
      if (target) {
        urlLoadedRef.current = true;
        setCurrentConvId(urlConvId);
        conversationIdRef.current = urlConvId;
        const rows = await conversationRepo.getMessages(urlConvId);
        setMessages(rows.map(rowToMessage));
      }
    }
  }, [urlConvId, rowToMessage]);

  useEffect(() => {
    refreshConversations();
    window.addEventListener("conversation-updated", refreshConversations);
    return () => window.removeEventListener("conversation-updated", refreshConversations);
  }, [refreshConversations]);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setErrorBanner(null);
    setCurrentConvId(null);
    conversationIdRef.current = null;
    currentAiMsgIdRef.current = null;
    thinkingBufRef.current = "";
    agentStepsRef.current = [];
  }, []);

  // ── 更新当前 AI 消息的 agentSteps（不可变更新，同步镜像到 ref）──
  const updateAgentSteps = useCallback(
    (updater: (prev: AgentStep[]) => AgentStep[]) => {
      const msgId = currentAiMsgIdRef.current;
      if (!msgId) return;
      const next = updater(agentStepsRef.current);
      agentStepsRef.current = next;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, agentSteps: next } : m
        )
      );
    },
    []
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || streaming || !currentModel) return;
      setErrorBanner(null);
      thinkingBufRef.current = "";

      const timestamp = nowTimestamp();

      const isFirstMessage = !conversationIdRef.current;
      if (isFirstMessage) {
        const conv = await conversationRepo.createConversation({
          title: content.slice(0, 30) || "新对话",
          modelLabel: currentModel.label,
          modelKeyId: currentModel.id,
        });
        conversationIdRef.current = conv.id;
        setCurrentConvId(conv.id);
        window.dispatchEvent(new CustomEvent("conversation-updated"));
      }
      const convId = conversationIdRef.current!;

      const savedUserMsg = await conversationRepo.appendMessage({
        conversationId: convId, role: "user", content, timestamp,
      });

      const userMsg: ChatMessage = {
        id: savedUserMsg.id, role: "user", content, timestamp, username: "You",
      };

      const assistantPlaceholderId = `msg-ai-${Date.now()}`;
      currentAiMsgIdRef.current = assistantPlaceholderId;
      agentStepsRef.current = []; // 重置 agentSteps 镜像

      const assistantMsg: ChatMessage = {
        id: assistantPlaceholderId, role: "assistant", content: "", timestamp,
        meta: { model: currentModel.label, inputTokens: 0, outputTokens: 0, ctxPercent: 0 },
        agentSteps: [],
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      let streamedContent = "";

      await sendMessage(
        currentModel,
        messages,
        content,
        // onDelta：最终回复文字增量
        (delta) => {
          streamedContent += delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantPlaceholderId ? { ...m, content: m.content + delta } : m
            )
          );
        },
        // onDone：流式结束，把 agentSteps 一起存入 DB
        async (inputTokens, outputTokens) => {
          // 从 ref 直接读取最终 agentSteps（同步可靠）
          const finalAgentSteps = agentStepsRef.current.length > 0
            ? agentStepsRef.current
            : undefined;

          const meta = {
            model: currentModel.label, inputTokens, outputTokens,
            wordCount: streamedContent.replace(/\s+/g, " ").split(" ").length,
            ctxPercent: 0,
            // agentSteps 持久化到 meta，切换会话时可恢复
            ...(finalAgentSteps ? { agentSteps: finalAgentSteps } : {}),
          };
          setMessages((prev) =>
            prev.map((m) => m.id === assistantPlaceholderId ? { ...m, meta } : m)
          );
          const savedAssistant = await conversationRepo.appendMessage({
            conversationId: convId, role: "assistant",
            content: streamedContent, timestamp, meta,
          });
          setMessages((prev) =>
            prev.map((m) => m.id === assistantPlaceholderId ? { ...m, id: savedAssistant.id } : m)
          );
          if (isFirstMessage) {
            generateTitle(currentModel, content).then((title) => {
              if (title) conversationRepo.updateConversation(convId, { title }).then(() =>
                window.dispatchEvent(new CustomEvent("conversation-updated"))
              );
            });
          }
        },
        // onError
        (errMsg) => {
          setErrorBanner(errMsg);
          setMessages((prev) => prev.filter((m) => m.id !== assistantPlaceholderId));
        },
        // onAgentEvent：tool_call / tool_result / reclassify
        (event: AgentEvent) => {
          if (event.type === "tool_call") {
            // 新增一个 running 节点，把当前积累的思考文字写入
            const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const thinkingText = thinkingBufRef.current.trim().slice(0, 80) || undefined; // 精简：最多 80 字
            thinkingBufRef.current = "";
            updateAgentSteps((prev) => [
              ...prev,
              {
                id: stepId,
                name: event.name,
                args: event.args,
                status: "running",
                thinkingText,
              } satisfies AgentStep,
            ]);
          } else if (event.type === "tool_result") {
            // 找到最近一个同名 running 节点，标记为 done
            updateAgentSteps((prev) => {
              const idx = [...prev].reverse().findIndex(
                (s) => s.name === event.name && s.status === "running"
              );
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              return prev.map((s, i) =>
                i === realIdx ? { ...s, status: "done" } : s
              );
            });
          } else if (event.type === "reclassify") {
            // 把 AI 气泡中已渲染的 delta 内容清空（已移入思考缓冲）
            thinkingBufRef.current += streamedContent;
            streamedContent = "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantPlaceholderId ? { ...m, content: "" } : m
              )
            );
          }
        },
        // onThinkingDelta：中间轮次思考文字，累积到 buffer
        (delta) => {
          thinkingBufRef.current += delta;
        },
        true,          // agentMode
        clientContext,
        convId,        // sessionId → 后端日志关联
      );
    },
    [messages, currentModel, sendMessage, streaming, clientContext, updateAgentSteps]
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
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>开始一段新对话</p>
          <p style={{ fontSize: "12px", margin: 0 }}>
            {modelsLoading ? "加载模型中..." : currentModel ? `当前模型：${currentModel.label}` : "请前往「设置 → API Key 管理」添加 Key"}
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
