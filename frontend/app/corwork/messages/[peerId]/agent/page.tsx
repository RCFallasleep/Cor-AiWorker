"use client";

/**
 * Agent 消息起草页 — /corwork/messages/[peerId]/agent
 *
 * 思路：「我的 Agent」帮我给对方起草、润色、发送消息。
 *   - System Prompt：你是我的 AI 助手，帮我给 {peerName} 起草消息
 *   - 对方的 ComMemory 注入 Prompt，让 Agent 了解对方背景
 *   - 对话中 Agent 可调用 forward_message 工具，直接将消息发送到对方的聊天列表
 *   - 使用本地 IndexedDB 中的 API Key（与 /chat 页面共享）
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { collabApi, memoriesApi, getToken, type AgentMemory } from "@/lib/api/client";
import { useAuth } from "@/contexts/auth-context";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import {
  ArrowLeft, Sparkles, Send, RefreshCw,
  ChevronDown, ChevronRight, Wrench, Bot, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingContent?: string;
  toolCalls?: ToolCallInfo[];
  createdAt: string;
}

// ── System Prompt 构建 ────────────────────────────────────────────────────────

function buildSystemPrompt(
  myName: string,
  peerName: string,
  peerAgentName: string | undefined,
  memories: AgentMemory[],
  senderUserId: string,
  peerUserId: string,
): string {
  const memorySection =
    memories.length > 0
      ? memories.map((m) => `### ${m.title || "记忆片段"}\n${m.content}`).join("\n\n")
      : "（暂无公开记忆）";

  return `你是 ${myName} 的 AI 助手，正在帮助 ${myName} 与联系人 ${peerName} 沟通。

你的职责：
1. 帮助 ${myName} 起草、润色发给 ${peerName} 的消息，使其更清晰、专业或友好
2. 根据 ${peerName} 的背景信息，给出沟通建议
3. 当 ${myName} 确认消息内容后，调用 forward_message 工具将消息发送给 ${peerName}

关于 ${peerName} 的公开背景信息：
${memorySection}

转发消息工具说明（forward_message）：
- 调用时必须传入：
  - receiver_id: "${peerUserId}"（固定，即 ${peerName} 的用户 ID）
  - sender_id: "${senderUserId}"（固定，即 ${myName} 的用户 ID）
  - content: 最终确认的消息内容
- 发送前请先向 ${myName} 展示消息内容并确认，获得明确同意后再调用

注意：
- 你代表 ${myName} 说话，起草的消息应以第一人称（"我"）表达
- 发送成功后，消息会出现在 ${peerName} 的聊天列表中，标注为「Agent 转发」`;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function AgentDraftPage() {
  const { peerId } = useParams<{ peerId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { models, loading: modelsLoading } = useAvailableModels();

  const [peerInfo, setPeerInfo] = useState<{
    id: string;
    display_name?: string;
    username?: string;
    agent_name?: string;
  } | null>(null);
  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // 模型列表加载完后默认选第一个
  useEffect(() => {
    if (!modelsLoading && models.length > 0 && !selectedModelId) {
      setSelectedModelId(models[0].id);
    }
  }, [models, modelsLoading, selectedModelId]);

  // 初始化：拉取对方信息 + ComMemory
  useEffect(() => {
    if (!user || !peerId) return;
    setLoadingInit(true);

    Promise.all([
      collabApi.listConversations(),
      memoriesApi.getPeerCommonMemories(peerId),
    ])
      .then(([convs, mems]) => {
        const conv = convs.find((c) => c.peer.id === peerId);
        const peer = conv?.peer ?? { id: peerId, username: peerId };
        setPeerInfo(peer);
        setMemories(mems);

        const peerName = peer.display_name || peer.username || peerId;
        const myName = user.display_name || user.username;
        const prompt = buildSystemPrompt(myName, peerName, peer.agent_name, mems, user.id, peerId);
        setSystemPrompt(prompt);

        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: `你好！我是你的 AI 助手。\n\n我可以帮你给 **${peerName}** 起草消息，或者根据他/她的背景给你沟通建议。\n\n告诉我你想说什么，我来帮你整理表达，确认后直接发送给对方。`,
            createdAt: new Date().toISOString(),
          },
        ]);
      })
      .catch(console.error)
      .finally(() => setLoadingInit(false));
  }, [user, peerId]);

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !user || !systemPrompt) return;
    if (!selectedModel) {
      alert("请先在设置中添加 API Key");
      return;
    }

    const content = input.trim();
    setInput("");

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        thinkingContent: "",
        toolCalls: [],
        createdAt: new Date().toISOString(),
      },
    ]);
    setStreaming(true);

    const history = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));

    abortRef.current = new AbortController();
    let reclassified = false;

    try {
      const token = getToken();
      const res = await fetch(`${BASE_URL}/v1/agent/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model: selectedModel.apiName,
          api_key: selectedModel.keyValue,
          base_url: selectedModel.baseUrl || undefined,
          extra_headers: selectedModel.extraHeaders || undefined,
          provider: selectedModel.provider === "anthropic" ? "anthropic" : undefined,
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content },
          ],
          stream: true,
          session_id: `agent-draft-${peerId}`,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) throw new Error(`请求失败 ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
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
          if (raw === "[DONE]") break;

          let evt: Record<string, unknown>;
          try { evt = JSON.parse(raw); } catch { continue; }

          const evtType = evt.type as string;

          if (evtType === "delta") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + (evt.content as string) }
                  : m
              )
            );
          } else if (evtType === "thinking_delta") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, thinkingContent: (m.thinkingContent ?? "") + (evt.content as string) }
                  : m
              )
            );
          } else if (evtType === "reclassify" && !reclassified) {
            reclassified = true;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                return { ...m, thinkingContent: (m.thinkingContent ?? "") + m.content, content: "" };
              })
            );
          } else if (evtType === "tool_call") {
            const toolName = evt.name as string;
            const toolArgs = (evt.args ?? {}) as Record<string, unknown>;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                return { ...m, toolCalls: [...(m.toolCalls ?? []), { name: toolName, args: toolArgs }] };
              })
            );
          } else if (evtType === "tool_result") {
            const toolName = evt.name as string;
            const toolResult = evt.content as string;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const calls = [...(m.toolCalls ?? [])];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i].name === toolName && !calls[i].result) {
                    calls[i] = { ...calls[i], result: toolResult };
                    break;
                  }
                }
                return { ...m, toolCalls: calls };
              })
            );
          } else if (evtType === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: `⚠️ ${evt.message as string}` } : m
              )
            );
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "⚠️ 请求失败，请检查后端连接或 API Key 配置。" }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }, [input, streaming, user, systemPrompt, messages, selectedModel, peerId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (authLoading || !user) return null;

  const peerName = peerInfo?.display_name || peerInfo?.username || peerId;
  const myName = user.display_name || user.username;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "var(--background)", overflow: "hidden" }}>

      {/* 顶部栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 20px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        {/* 返回 */}
        <button
          onClick={() => router.push(`/corwork/messages/${peerId}`)}
          title="返回聊天"
          style={{ width: "28px", height: "28px", borderRadius: "7px", border: "none", cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <ArrowLeft size={15} />
        </button>

        {/* 我的 Agent 头像 */}
        <div style={{ width: "34px", height: "34px", borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Sparkles size={16} color="#fff" />
        </div>

        {/* 标题：我的 Agent → 对方 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>我的 Agent</span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>→</span>
            <span style={{ color: "#a78bfa" }}>{peerName}</span>
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "3px" }}>
            <Bot size={9} />
            帮你起草消息 · {memories.length} 条对方背景
          </div>
        </div>

        {/* 模型选择器 */}
        {models.length > 0 && (
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            style={{
              fontSize: "11px", padding: "4px 8px", borderRadius: "6px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-hover)", color: "var(--text-primary)",
              cursor: "pointer", outline: "none", maxWidth: "120px",
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
        {models.length === 0 && !modelsLoading && (
          <span style={{ fontSize: "11px", color: "#f59e0b", padding: "4px 8px", borderRadius: "6px", backgroundColor: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
            未配置 API Key
          </span>
        )}

        {/* 刷新记忆 */}
        <button
          onClick={async () => {
            const mems = await memoriesApi.getPeerCommonMemories(peerId);
            setMemories(mems);
            const myN = user.display_name || user.username;
            const peerN = peerInfo?.display_name || peerInfo?.username || peerId;
            const prompt = buildSystemPrompt(myN, peerN, peerInfo?.agent_name, mems, user.id, peerId);
            setSystemPrompt(prompt);
          }}
          title="刷新对方背景记忆"
          style={{ width: "28px", height: "28px", borderRadius: "7px", border: "none", cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {loadingInit ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "13px", padding: "40px" }}>
            正在加载 {peerName} 的背景信息...
          </div>
        ) : (
          messages.map((msg) => (
            <DraftMessageBubble key={msg.id} msg={msg} myName={myName} peerName={peerName} />
          ))
        )}
        {streaming && messages[messages.length - 1]?.content === "" && messages[messages.length - 1]?.role === "assistant" && (
          <div style={{ display: "flex", alignItems: "center", gap: "4px", paddingLeft: "36px" }}>
            {[0, 0.2, 0.4].map((delay, i) => (
              <span key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#818cf8", display: "inline-block", animation: `draftPulse 1s ${delay}s infinite` }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        {/* 快捷提示 */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
          {[
            "帮我起草一条消息",
            "我想约他/她开会",
            "帮我问一下进度",
          ].map((hint) => (
            <button
              key={hint}
              onClick={() => setInput(hint)}
              style={{
                fontSize: "11px", padding: "3px 10px", borderRadius: "12px",
                border: "1px solid var(--border-color)",
                backgroundColor: "transparent", color: "var(--text-muted)",
                cursor: "pointer", transition: "all 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#818cf8"; e.currentTarget.style.color = "#818cf8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {hint}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`告诉我你想对 ${peerName} 说什么... (Enter 发送，Shift+Enter 换行)`}
            rows={1}
            style={{
              flex: 1, padding: "10px 14px", borderRadius: "10px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--sidebar-hover)", color: "var(--text-primary)",
              fontSize: "14px", outline: "none", resize: "none",
              lineHeight: "1.5", maxHeight: "120px", overflowY: "auto", fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming || !selectedModel}
            style={{
              width: "38px", height: "38px", borderRadius: "10px", border: "none",
              cursor: input.trim() && !streaming && selectedModel ? "pointer" : "not-allowed",
              background: input.trim() && !streaming && selectedModel
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : "var(--sidebar-hover)",
              color: input.trim() && !streaming && selectedModel ? "#fff" : "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "all 0.15s ease",
            }}
          >
            <Send size={15} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes draftPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── 消息气泡 ──────────────────────────────────────────────────────────────────

function DraftMessageBubble({
  msg,
  myName,
  peerName,
}: {
  msg: ChatMessage;
  myName: string;
  peerName: string;
}) {
  const [thinkingOpen, setThinkingOpen] = useState(false);

  if (msg.role === "user") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{myName}</div>
          <div style={{
            padding: "10px 14px", borderRadius: "14px 14px 4px 14px",
            backgroundColor: "var(--accent)", color: "#fff",
            fontSize: "14px", lineHeight: "1.6", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {msg.content}
          </div>
        </div>
      </div>
    );
  }

  // assistant 消息
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
      {/* 我的 Agent 头像 */}
      <div style={{
        width: "28px", height: "28px", borderRadius: "50%",
        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, marginTop: "2px",
      }}>
        <Sparkles size={12} color="#fff" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "11px", color: "#818cf8", marginBottom: "4px", fontWeight: 500 }}>
          我的 Agent
        </div>

        {/* 思考过程（可折叠） */}
        {msg.thinkingContent && (
          <div style={{ marginBottom: "6px" }}>
            <button
              onClick={() => setThinkingOpen((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
            >
              {thinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              思考过程
            </button>
            {thinkingOpen && (
              <div style={{
                marginTop: "4px", padding: "8px 12px", borderRadius: "8px",
                backgroundColor: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
                fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.6",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {msg.thinkingContent}
              </div>
            )}
          </div>
        )}

        {/* 工具调用列表 */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div style={{ marginBottom: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
            {msg.toolCalls.map((tc, i) => (
              <ToolCallCard key={i} tc={tc} peerName={peerName} />
            ))}
          </div>
        )}

        {/* 最终回复 */}
        {(msg.content || (!msg.thinkingContent && !msg.toolCalls?.length)) && (
          <div style={{
            padding: "10px 14px", borderRadius: "4px 14px 14px 14px",
            backgroundColor: "var(--sidebar-hover)", border: "1px solid var(--border-subtle)",
            fontSize: "14px", lineHeight: "1.6", color: "var(--text-primary)", wordBreak: "break-word",
          }}>
            {msg.content ? (
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p style={{ margin: "0 0 8px", lineHeight: "1.6" }}>{children}</p>,
                  code: ({ children }) => (
                    <code style={{ backgroundColor: "rgba(99,102,241,0.1)", padding: "1px 5px", borderRadius: "4px", fontSize: "13px", fontFamily: "monospace" }}>
                      {children}
                    </code>
                  ),
                  strong: ({ children }) => <strong style={{ color: "#818cf8" }}>{children}</strong>,
                }}
              >
                {msg.content}
              </ReactMarkdown>
            ) : (
              <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>思考中...</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 工具调用卡片 ──────────────────────────────────────────────────────────────

function ToolCallCard({ tc, peerName }: { tc: ToolCallInfo; peerName: string }) {
  const [open, setOpen] = useState(false);
  const isForward = tc.name === "forward_message";
  const isDone = !!tc.result;
  const isSuccess = isDone && tc.result?.startsWith("✅");

  return (
    <div style={{
      borderRadius: "8px",
      border: `1px solid ${isForward ? "rgba(99,102,241,0.3)" : "var(--border-subtle)"}`,
      backgroundColor: isForward ? "rgba(99,102,241,0.05)" : "rgba(99,102,241,0.03)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        {isForward
          ? <Zap size={11} color="#818cf8" />
          : <Wrench size={11} color="#6366f1" />
        }
        <span style={{ fontSize: "12px", color: "#818cf8", fontWeight: 500, flex: 1 }}>
          {isForward ? `📨 发送给 ${peerName}` : tc.name}
        </span>
        <span style={{
          fontSize: "10px", padding: "1px 6px", borderRadius: "10px",
          backgroundColor: isSuccess ? "rgba(34,197,94,0.15)" : isDone ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)",
          color: isSuccess ? "#16a34a" : isDone ? "#dc2626" : "#ca8a04",
        }}>
          {isSuccess ? "已发送" : isDone ? "失败" : "发送中..."}
        </span>
        {open ? <ChevronDown size={11} color="var(--text-muted)" /> : <ChevronRight size={11} color="var(--text-muted)" />}
      </button>

      {open && (
        <div style={{ padding: "0 10px 8px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {isForward && tc.args.content && (
            <>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>消息内容：</div>
              <div style={{ padding: "6px 8px", borderRadius: "6px", backgroundColor: "var(--background)", fontSize: "12px", color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderLeft: "2px solid #818cf8" }}>
                {tc.args.content as string}
              </div>
            </>
          )}
          {!isForward && (
            <>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>参数：</div>
              <pre style={{ margin: 0, padding: "6px 8px", borderRadius: "6px", backgroundColor: "var(--background)", fontSize: "11px", color: "var(--text-primary)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </>
          )}
          {tc.result && (
            <>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>结果：</div>
              <div style={{ padding: "6px 8px", borderRadius: "6px", backgroundColor: "var(--background)", fontSize: "11px", color: isSuccess ? "#16a34a" : "#dc2626", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {tc.result}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
