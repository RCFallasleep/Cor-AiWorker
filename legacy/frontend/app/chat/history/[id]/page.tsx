"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MessageSquare, ExternalLink, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { conversationRepo, type ConversationRow } from "@/lib/repositories/conversation-repository";
import type { MessageRow } from "@/lib/db/idb";

// ── 时间格式化 ──
function formatAbsolute(ts: number): string {
  const d   = new Date(ts);
  const now = new Date();
  const hh  = d.getHours().toString().padStart(2, "0");
  const mm  = d.getMinutes().toString().padStart(2, "0");
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate();
  if (isToday) return `今天 ${hh}:${mm}`;
  const mo = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${mo}/${dd} ${hh}:${mm}`;
}

// ── 只读消息气泡 ──
function ReadonlyMessage({ msg }: { msg: MessageRow }) {
  const isUser = msg.role === "user";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: "16px",
      }}
    >
      {/* 角色标签 */}
      <div
        style={{
          fontSize: "11px", color: "var(--text-muted)",
          marginBottom: "4px",
          paddingLeft: isUser ? 0 : "4px",
          paddingRight: isUser ? "4px" : 0,
        }}
      >
        {isUser ? "You" : (msg.meta?.model ?? "Assistant")}
        {msg.createdAt ? ` · ${formatAbsolute(msg.createdAt)}` : ""}
      </div>

      {/* 气泡 */}
      <div
        style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          backgroundColor: isUser ? "var(--accent-blue)" : "var(--card-bg)",
          color: isUser ? "#fff" : "var(--text-primary)",
          fontSize: "14px",
          lineHeight: "1.65",
          border: isUser ? "none" : "1px solid var(--border-subtle)",
          wordBreak: "break-word",
        }}
      >
        {isUser ? (
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
        ) : (
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const code  = String(children).replace(/\n$/, "");
                const isBlock = code.includes("\n") || match;
                if (isBlock) {
                  return (
                    <SyntaxHighlighter
                      language={match?.[1] ?? "text"}
                      style={oneDark}
                      customStyle={{ margin: "6px 0", padding: "12px 14px", fontSize: "13px", borderRadius: "8px" }}
                    >
                      {code}
                    </SyntaxHighlighter>
                  );
                }
                return (
                  <code
                    style={{
                      backgroundColor: "rgba(255,255,255,0.08)",
                      padding: "1px 5px", borderRadius: "4px",
                      fontSize: "13px", fontFamily: "monospace",
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
              ul: ({ children }) => <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>{children}</ul>,
              ol: ({ children }) => <ol style={{ margin: "4px 0", paddingLeft: "20px" }}>{children}</ol>,
              li: ({ children }) => <li style={{ marginBottom: "2px" }}>{children}</li>,
            }}
          >
            {msg.content}
          </ReactMarkdown>
        )}
      </div>

      {/* assistant meta */}
      {!isUser && msg.meta && (
        <div style={{ display: "flex", gap: "8px", marginTop: "4px", paddingLeft: "4px" }}>
          {msg.meta.inputTokens !== undefined && (
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              ↑{msg.meta.inputTokens} ↓{msg.meta.outputTokens}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ──
export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const convId = params.id;

  const [conv,     setConv]     = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!convId) return;
    (async () => {
      setLoading(true);
      const c = await conversationRepo.getConversation(convId);
      if (!c) { setNotFound(true); setLoading(false); return; }
      const msgs = await conversationRepo.getMessages(convId);
      setConv(c);
      setMessages(msgs);
      setLoading(false);
    })();
  }, [convId]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: "8px", color: "var(--text-muted)" }}>
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: "13px" }}>加载中...</span>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (notFound || !conv) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px" }}>
        <MessageSquare size={36} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>找不到该对话</p>
        <button
          onClick={() => router.push("/chat/history")}
          style={{ fontSize: "13px", color: "var(--accent-blue)", background: "none", border: "none", cursor: "pointer", outline: "none" }}
        >
          返回历史记录
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 顶部导航栏 */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          backgroundColor: "var(--topbar-bg)",
          flexShrink: 0, gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <button
            onClick={() => router.push("/chat/history")}
            title="返回历史记录"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "30px", height: "30px", borderRadius: "8px",
              border: "none", backgroundColor: "var(--sidebar-hover)",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none", flexShrink: 0,
            }}
          >
            <ArrowLeft size={15} />
          </button>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "14px", fontWeight: 600, color: "var(--text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {conv.title}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
              <span
                style={{
                  fontSize: "11px", color: "var(--accent-blue)",
                  backgroundColor: "rgba(59,130,246,0.1)",
                  padding: "1px 6px", borderRadius: "4px", fontFamily: "monospace",
                }}
              >
                {conv.modelLabel}
              </span>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                {conv.messageCount} 条消息 · {formatAbsolute(conv.createdAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 在 Chat 中继续 */}
        <button
          onClick={() => router.push(`/chat?id=${conv.id}`)}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "6px 12px", borderRadius: "8px",
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--card-bg)",
            color: "var(--text-secondary)", fontSize: "12px",
            cursor: "pointer", outline: "none", flexShrink: 0,
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--accent-blue)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-blue)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-color)";
          }}
        >
          <ExternalLink size={13} />
          在聊天中继续
        </button>
      </div>

      {/* 只读消息列表 */}
      <div
        style={{
          flex: 1, overflowY: "auto",
          padding: "24px 20px",
          maxWidth: "860px", width: "100%", margin: "0 auto", boxSizing: "border-box",
        }}
      >
        {messages.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "13px", marginTop: "60px" }}>
            该对话暂无消息记录
          </div>
        ) : (
          messages.map((msg) => <ReadonlyMessage key={msg.id} msg={msg} />)
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
