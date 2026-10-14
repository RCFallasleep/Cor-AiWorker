"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { collabApi, createCollabWS, type Conversation, type FriendRequest } from "@/lib/api/client";
import { useAuth } from "@/contexts/auth-context";
import { MessageCircle, UserPlus, Search, Bot, Bell, Sparkles } from "lucide-react";
import FriendRequestInbox from "./friend-request-inbox";
import ContactCard from "./contact-card";

export default function ConversationList() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showInbox, setShowInbox] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingReq, setSendingReq] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // 当前激活的 peerId（从路径中提取）
  const activePeerId = pathname.startsWith("/corwork/messages/")
    ? pathname.split("/corwork/messages/")[1]?.split("/")[0]
    : null;

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const convs = await collabApi.listConversations();
      setConversations(convs);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadPendingCount = useCallback(async () => {
    if (!user) return;
    try {
      const list = await collabApi.listPendingRequests();
      setPendingCount(list.length);
    } catch {
      // 静默失败：后端可能尚未重启，friend_requests 表还不存在
    }
  }, [user]);

  useEffect(() => {
    loadConversations();
    loadPendingCount();
  }, [loadConversations, loadPendingCount]);

  // WebSocket：监听好友申请 / 好友申请结果 / 新消息
  useEffect(() => {
    if (!user) return;
    wsRef.current?.close();

    const ws = createCollabWS((data) => {
      const payload = data as { type: string; data?: unknown };

      if (payload.type === "friend_request") {
        // 收到新的好友申请，角标 +1
        setPendingCount((n) => n + 1);
      }

      if (payload.type === "friend_request_result") {
        // 我发出的申请被处理了（accepted/rejected）
        const d = payload.data as { action: string; by: { display_name: string; username: string } };
        const byName = d.by.display_name || d.by.username;
        if (d.action === "accept") {
          // 刷新会话列表（对方现在是好友了）
          loadConversations();
          // 简单 toast 提示
          console.info(`[好友] ${byName} 同意了你的申请`);
        }
      }

      if (payload.type === "new_message") {
        // 有新消息，刷新会话列表（更新最新消息和未读数）
        loadConversations();
      }

      if (payload.type === "friend_removed") {
        // 被对方删除，刷新列表
        loadConversations();
      }
    });

    wsRef.current = ws;
    return () => { ws?.close(); };
  }, [user, loadConversations]);

  const handleSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const results = await collabApi.searchUsers(searchQ);
      setSearchResults(results as SearchUser[]);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (targetUser: SearchUser) => {
    setSendingReq(true);
    try {
      await collabApi.sendFriendRequest(targetUser.username);
      setShowAddContact(false);
      setSearchQ("");
      setSearchResults([]);
      // 简单提示
      alert(`已向 ${targetUser.display_name || targetUser.username} 发送好友申请`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSendingReq(false);
    }
  };

  return (
    <div
      style={{
        width: "260px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--border-subtle)",
        backgroundColor: "var(--sidebar-bg)",
        position: "relative",
      }}
    >
      {/* 顶部栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
          消息
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {/* 好友申请通知 */}
          <button
            onClick={() => { setShowInbox((v) => !v); setShowAddContact(false); }}
            title="好友申请"
            style={{
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "7px",
              border: "none", cursor: "pointer",
              backgroundColor: showInbox ? "var(--sidebar-hover)" : "transparent",
              color: pendingCount > 0 ? "var(--accent)" : "var(--text-muted)",
              outline: "none", transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = showInbox ? "var(--sidebar-hover)" : "transparent")}
          >
            <Bell size={15} />
            {pendingCount > 0 && (
              <span
                style={{
                  position: "absolute", top: "2px", right: "2px",
                  minWidth: "14px", height: "14px", borderRadius: "7px",
                  backgroundColor: "#ef4444", color: "#fff",
                  fontSize: "9px", fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: "0 3px",
                  boxShadow: "0 0 0 2px var(--sidebar-bg)",
                }}
              >
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            )}
          </button>

          {/* 添加好友 */}
          <button
            onClick={() => { setShowAddContact(true); setShowInbox(false); }}
            title="添加好友"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "7px",
              border: "none", cursor: "pointer",
              backgroundColor: "transparent", color: "var(--text-muted)",
              outline: "none", transition: "background 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <UserPlus size={15} />
          </button>
        </div>
      </div>

      {/* 好友申请收件箱 */}
      {showInbox && (
        <FriendRequestInbox
          onClose={() => setShowInbox(false)}
          onAccepted={() => {
            setPendingCount((n) => Math.max(0, n - 1));
            loadConversations();
          }}
        />
      )}

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
            加载中...
          </div>
        ) : conversations.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center" }}>
            <MessageCircle
              size={32}
              style={{ color: "var(--text-muted)", margin: "0 auto 10px", display: "block", opacity: 0.35 }}
            />
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "4px" }}>还没有消息</p>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", opacity: 0.6 }}>
              点击右上角添加好友
            </p>
          </div>
        ) : (
          conversations.map((conv) => (
            <ConvItem
              key={conv.peer.id}
              conv={conv}
              isActive={conv.peer.id === activePeerId}
              onClick={() => router.push(`/corwork/messages/${conv.peer.id}`)}
              onOpenAgentChat={() => router.push(`/corwork/messages/${conv.peer.id}/agent`)}
            />
          ))
        )}
      </div>

      {/* 添加好友弹窗 */}
      {showAddContact && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            backgroundColor: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowAddContact(false); setSearchQ(""); setSearchResults([]); } }}
        >
          <div
            style={{
              width: "380px",
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
              添加好友
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              搜索用户名，发送好友申请，对方同意后即可聊天
            </p>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="输入用户名搜索..."
                autoFocus
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: "8px",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--background)", color: "var(--text-primary)",
                  fontSize: "13px", outline: "none",
                }}
              />
              <button
                onClick={handleSearch}
                disabled={searching}
                style={{
                  padding: "9px 14px", borderRadius: "8px",
                  border: "none", cursor: "pointer",
                  backgroundColor: "var(--accent)", color: "#fff",
                  fontSize: "13px", display: "flex", alignItems: "center", gap: "4px",
                  opacity: searching ? 0.7 : 1,
                }}
              >
                <Search size={13} />
              </button>
            </div>

            <div style={{ maxHeight: "220px", overflowY: "auto" }}>
              {searchResults.map((u) => (
                <div
                  key={u.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 12px", borderRadius: "8px",
                    backgroundColor: "var(--sidebar-hover)", marginBottom: "6px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "34px", height: "34px", borderRadius: "50%",
                        backgroundColor: u.agent_name ? "#7c3aed" : "var(--accent)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "13px", fontWeight: 700, color: "#fff", flexShrink: 0,
                      }}
                    >
                      {u.agent_name ? <Bot size={15} color="#fff" /> : (u.display_name || u.username)[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                        {u.display_name || u.username}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                        @{u.username}{u.agent_name ? ` · ${u.agent_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleSendRequest(u)}
                    disabled={sendingReq}
                    style={{
                      padding: "5px 12px", borderRadius: "6px",
                      border: "none", cursor: sendingReq ? "not-allowed" : "pointer",
                      backgroundColor: "var(--accent)", color: "#fff",
                      fontSize: "12px", whiteSpace: "nowrap",
                      opacity: sendingReq ? 0.7 : 1,
                    }}
                  >
                    申请
                  </button>
                </div>
              ))}
              {searchResults.length === 0 && searchQ && !searching && (
                <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "13px", padding: "16px" }}>
                  未找到用户
                </p>
              )}
            </div>

            <button
              onClick={() => { setShowAddContact(false); setSearchQ(""); setSearchResults([]); }}
              style={{
                marginTop: "12px", width: "100%", padding: "9px",
                borderRadius: "8px", border: "1px solid var(--border-color)",
                cursor: "pointer", backgroundColor: "transparent",
                color: "var(--text-muted)", fontSize: "13px",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface SearchUser {
  id: string;
  username: string;
  display_name: string;
  agent_name?: string;
}

// ── 会话条目 ──────────────────────────────────────────────────────────────────

function ConvItem({
  conv,
  isActive,
  onClick,
  onOpenAgentChat,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
  onOpenAgentChat: () => void;
}) {
  const peer = conv.peer;
  const peerName = peer.display_name || peer.username;
  const lastMsg = conv.last_message;
  const timeStr = lastMsg
    ? new Date(lastMsg.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "";

  const [cardAnchor, setCardAnchor] = useState<{ x: number; y: number } | null>(null);

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cardAnchor) {
      setCardAnchor(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCardAnchor({ x: rect.right + 8, y: rect.top });
  };

  return (
    <>
      <div
        onClick={onClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 14px",
          cursor: "pointer",
          backgroundColor: isActive ? "var(--sidebar-active, rgba(99,102,241,0.12))" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          transition: "background 0.12s",
          position: "relative",
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = "var(--sidebar-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        {/* 头像（点击弹出联系人卡片） */}
        <div
          onClick={handleAvatarClick}
          title="查看联系人信息"
          style={{
            width: "36px", height: "36px", borderRadius: "50%",
            backgroundColor: peer.agent_name ? "#7c3aed" : "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: "14px", fontWeight: 700, color: "#fff",
            cursor: "pointer",
            outline: cardAnchor ? "2px solid var(--accent)" : "none",
            outlineOffset: "2px",
            transition: "outline 0.1s",
          }}
        >
          {peer.agent_name ? <Bot size={16} color="#fff" /> : peerName[0]?.toUpperCase()}
        </div>

        {/* 文字区 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
            <span
              style={{
                fontSize: "13px", fontWeight: 500, color: "var(--text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {peerName}
            </span>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", flexShrink: 0, marginLeft: "6px" }}>
              {timeStr}
            </span>
          </div>
          <div
            style={{
              fontSize: "12px", color: "var(--text-muted)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {lastMsg?.content || "暂无消息"}
          </div>
        </div>

        {/* 未读角标 */}
        {conv.unread_count > 0 && (
          <div
            style={{
              minWidth: "18px", height: "18px", borderRadius: "9px",
              backgroundColor: "var(--accent)", color: "#fff",
              fontSize: "10px", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 4px", flexShrink: 0,
            }}
          >
            {conv.unread_count > 99 ? "99+" : conv.unread_count}
          </div>
        )}
      </div>

      {/* 联系人小卡片 */}
      {cardAnchor && (
        <ContactCard
          peer={peer}
          anchor={cardAnchor}
          onClose={() => setCardAnchor(null)}
          onSendMessage={() => { setCardAnchor(null); onClick(); }}
          onOpenAgentChat={() => { setCardAnchor(null); onOpenAgentChat(); }}
        />
      )}
    </>
  );
}
