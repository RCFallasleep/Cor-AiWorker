"use client";

import { useEffect, useRef } from "react";
import { Bot, MessageCircle, Sparkles, X } from "lucide-react";

interface Peer {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  agent_name?: string;
  agent_avatar?: string;
}

interface ContactCardProps {
  peer: Peer;
  anchor: { x: number; y: number };
  onClose: () => void;
  onSendMessage: () => void;
  onOpenAgentChat: () => void;
}

/**
 * 联系人小卡片
 * 点击会话列表头像后弹出，提供「发消息」和「让 Agent 帮我起草消息」两个入口。
 */
export default function ContactCard({
  peer,
  anchor,
  onClose,
  onSendMessage,
  onOpenAgentChat,
}: ContactCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const peerName = peer.display_name || peer.username;

  // 点击卡片外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // 计算卡片位置，防止超出视口底部
  const cardHeight = 180;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const top = anchor.y + cardHeight > viewportHeight
    ? Math.max(8, viewportHeight - cardHeight - 8)
    : anchor.y;

  return (
    <div
      ref={cardRef}
      style={{
        position: "fixed",
        left: anchor.x,
        top,
        zIndex: 300,
        width: "220px",
        backgroundColor: "var(--sidebar-bg)",
        border: "1px solid var(--border-color)",
        borderRadius: "14px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
        overflow: "hidden",
        animation: "fadeInScale 0.12s ease",
      }}
    >
      <style>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.94) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: "8px", right: "8px",
          width: "20px", height: "20px", borderRadius: "50%",
          border: "none", cursor: "pointer",
          backgroundColor: "transparent", color: "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0,
        }}
      >
        <X size={12} />
      </button>

      {/* 用户信息 */}
      <div
        style={{
          padding: "16px 16px 12px",
          display: "flex", alignItems: "center", gap: "10px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            width: "40px", height: "40px", borderRadius: "50%",
            backgroundColor: peer.agent_name ? "#7c3aed" : "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: "16px", fontWeight: 700, color: "#fff",
          }}
        >
          {peer.agent_name ? <Bot size={18} color="#fff" /> : peerName[0]?.toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: "13px", fontWeight: 600, color: "var(--text-primary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {peerName}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "1px" }}>
            @{peer.username}
          </div>
          {peer.agent_name && (
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: "3px",
                marginTop: "3px", padding: "1px 6px", borderRadius: "4px",
                backgroundColor: "rgba(124,58,237,0.12)",
                fontSize: "10px", color: "#a78bfa",
              }}
            >
              <Bot size={9} />
              {peer.agent_name}
            </div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ padding: "8px" }}>
        {/* 发消息 */}
        <button
          onClick={onSendMessage}
          style={{
            width: "100%", padding: "9px 12px",
            display: "flex", alignItems: "center", gap: "8px",
            borderRadius: "8px", border: "none", cursor: "pointer",
            backgroundColor: "transparent", color: "var(--text-primary)",
            fontSize: "13px", textAlign: "left", transition: "background 0.1s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <MessageCircle size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          发消息
        </button>

        {/* Agent 起草消息 */}
        <button
          onClick={onOpenAgentChat}
          style={{
            width: "100%", padding: "9px 12px",
            display: "flex", alignItems: "center", gap: "8px",
            borderRadius: "8px", border: "none", cursor: "pointer",
            backgroundColor: "transparent", color: "var(--text-primary)",
            fontSize: "13px", textAlign: "left", transition: "background 0.1s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <Sparkles size={14} style={{ color: "#818cf8", flexShrink: 0 }} />
          <span>
            让 Agent 帮我给 <strong style={{ color: "#818cf8" }}>{peerName}</strong> 起草消息
          </span>
        </button>
      </div>
    </div>
  );
}
