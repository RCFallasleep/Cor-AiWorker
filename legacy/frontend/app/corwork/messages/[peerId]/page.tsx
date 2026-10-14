"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { collabApi, createCollabWS, type Message } from "@/lib/api/client";
import { useAuth } from "@/contexts/auth-context";
import { Send, Bot, Sparkles } from "lucide-react";

export default function ChatPage() {
  const { peerId } = useParams<{ peerId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [peerInfo, setPeerInfo] = useState<{
    display_name?: string;
    username?: string;
    agent_name?: string;
  } | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // 加载消息历史 + 对方信息
  useEffect(() => {
    if (!user || !peerId) return;
    setLoading(true);
    setMessages([]);
    Promise.all([
      collabApi.getMessages(peerId),
      collabApi.listConversations(),
    ])
      .then(([msgs, convs]) => {
        setMessages(msgs);
        const conv = convs.find((c) => c.peer.id === peerId);
        if (conv) setPeerInfo(conv.peer);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user, peerId]);

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // WebSocket 实时接收（每次 peerId 变化重新建立）
  useEffect(() => {
    if (!user) return;

    // 关闭旧连接
    wsRef.current?.close();

    const ws = createCollabWS((data) => {
      const payload = data as { type: string; data?: Message };
      if (payload.type === "new_message" && payload.data) {
        const msg = payload.data;
        if (msg.sender_id === peerId || msg.receiver_id === peerId) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      }
    });
    wsRef.current = ws;

    return () => {
      ws?.close();
    };
  }, [user, peerId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending || !user) return;
    const content = input.trim();
    setInput("");
    setSending(true);

    // 乐观更新
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      conversation_id: "",
      sender_id: user.id,
      receiver_id: peerId,
      content,
      msg_type: "text",
      is_agent_reply: 0,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const sent = await collabApi.sendMessage(peerId, content);
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? sent : m)));
    } catch (e) {
      console.error(e);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [input, sending, user, peerId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (authLoading || !user) return null;

  const peerName = peerInfo?.display_name || peerInfo?.username || peerId;
  const agentName = peerInfo?.agent_name;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--background)",
        overflow: "hidden",
      }}
    >
      {/* 顶部栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {/* 头像 */}
        <div
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            backgroundColor: agentName ? "#7c3aed" : "var(--accent)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "14px",
            fontWeight: 700,
            color: "#fff",
          }}
        >
          {agentName ? <Bot size={16} color="#fff" /> : peerName[0]?.toUpperCase()}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {peerName}
          </div>
          {agentName && (
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: "3px",
              }}
            >
              <Bot size={10} />
              {agentName}
            </div>
          )}
        </div>

        {/* Agent 起草消息入口 */}
        <button
          onClick={() => router.push(`/corwork/messages/${peerId}/agent`)}
          title="让我的 Agent 帮你起草消息"
          style={{
            display: "flex", alignItems: "center", gap: "5px",
            padding: "5px 10px", borderRadius: "8px",
            border: "1px solid rgba(99,102,241,0.3)",
            cursor: "pointer",
            backgroundColor: "rgba(99,102,241,0.06)",
            color: "#818cf8",
            fontSize: "12px", fontWeight: 500,
            transition: "all 0.15s ease",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.12)";
            e.currentTarget.style.borderColor = "rgba(99,102,241,0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "rgba(99,102,241,0.06)";
            e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)";
          }}
        >
          <Sparkles size={12} />
          Agent 起草
        </button>
      </div>

      {/* 消息列表 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {loading ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              padding: "40px",
            }}
          >
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              padding: "40px",
            }}
          >
            发送第一条消息，开始协作
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} isMine={msg.sender_id === user.id} peerName={peerName} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <div
        style={{
          padding: "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          flexShrink: 0,
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
          rows={1}
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid var(--border-color)",
            backgroundColor: "var(--sidebar-hover)",
            color: "var(--text-primary)",
            fontSize: "14px",
            outline: "none",
            resize: "none",
            lineHeight: "1.5",
            maxHeight: "120px",
            overflowY: "auto",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "10px",
            border: "none",
            cursor: input.trim() && !sending ? "pointer" : "not-allowed",
            backgroundColor:
              input.trim() && !sending ? "var(--accent)" : "var(--sidebar-hover)",
            color: input.trim() && !sending ? "#fff" : "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 0.15s ease",
          }}
        >
          <Send size={15} />
        </button>
      </div>

    </div>
  );
}

// ── 消息气泡 ──────────────────────────────────────────────────────────────────

function MessageBubble({ msg, isMine, peerName }: { msg: Message; isMine: boolean; peerName: string }) {
  const isAgent = msg.is_agent_reply === 1;
  const isAgentForward = msg.msg_type === "agent_forward";
  const timeStr = new Date(msg.created_at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // agent_forward 类型：特殊紫色气泡，显示「TA 的 Agent，转发自 [我]」标识
  if (isAgentForward) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: isMine ? "row-reverse" : "row",
          alignItems: "flex-end",
          gap: "8px",
        }}
      >
        {/* 头像：Sparkles 图标 */}
        {!isMine && (
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #6366f1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Sparkles size={13} color="#fff" />
          </div>
        )}

        <div
          style={{
            maxWidth: "68%",
            display: "flex",
            flexDirection: "column",
            alignItems: isMine ? "flex-end" : "flex-start",
            gap: "3px",
          }}
        >
          {/* 标识标签 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "10px",
              color: "#a78bfa",
              fontWeight: 500,
            }}
          >
            <Sparkles size={9} color="#a78bfa" />
            {isMine
              ? "我的 Agent 转发"
              : "TA 的 Agent 转发"}
          </div>

          {/* 气泡 */}
          <div
            style={{
              padding: "9px 13px",
              borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: isMine
                ? "linear-gradient(135deg, rgba(124,58,237,0.85), rgba(99,102,241,0.85))"
                : "rgba(124,58,237,0.08)",
              color: isMine ? "#fff" : "var(--text-primary)",
              fontSize: "14px",
              lineHeight: "1.5",
              border: "1px solid rgba(124,58,237,0.3)",
              wordBreak: "break-word",
              position: "relative",
            }}
          >
            {msg.content}
          </div>

          {/* 时间 */}
          <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{timeStr}</span>
        </div>
      </div>
    );
  }

  // 普通消息气泡
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMine ? "row-reverse" : "row",
        alignItems: "flex-end",
        gap: "8px",
      }}
    >
      {/* 对方头像 */}
      {!isMine && (
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            backgroundColor: isAgent ? "#7c3aed" : "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "12px",
          }}
        >
          {isAgent
            ? <Bot size={14} color="#fff" />
            : <span style={{ fontSize: "13px", fontWeight: 700 }}>{peerName[0]?.toUpperCase()}</span>
          }
        </div>
      )}

      <div
        style={{
          maxWidth: "68%",
          display: "flex",
          flexDirection: "column",
          alignItems: isMine ? "flex-end" : "flex-start",
          gap: "3px",
        }}
      >
        {/* 气泡 */}
        <div
          style={{
            padding: "9px 13px",
            borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
            backgroundColor: isMine
              ? "var(--accent)"
              : isAgent
              ? "rgba(124,58,237,0.12)"
              : "var(--sidebar-hover)",
            color: isMine ? "#fff" : "var(--text-primary)",
            fontSize: "14px",
            lineHeight: "1.5",
            border: isAgent && !isMine ? "1px solid rgba(124,58,237,0.25)" : "none",
            wordBreak: "break-word",
          }}
        >
          {msg.content}
        </div>
        {/* 时间 */}
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{timeStr}</span>
      </div>
    </div>
  );
}
