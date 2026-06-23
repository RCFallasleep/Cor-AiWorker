"use client";

/**
 * Agent 收件箱页面 — /corwork/agent-inbox
 *
 * 布局：左侧消息列表 + 右侧详情面板（QQ 邮箱风格）
 * 消息来源：
 *   - agent_forward  — 来自其他用户 Agent 的转发消息
 *   - task_remind    — 我的 Agent 发出的定时任务提醒
 *   - task_report    — 定时任务执行完成的汇报
 *   - system         — 系统通知
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { agentInboxApi, createCollabWS, type AgentInboxMessage } from "@/lib/api/client";
import {
  Inbox, Bot, Sparkles, Clock, CheckCheck, Trash2,
  MailOpen, Mail, RefreshCw, ChevronRight, Zap, Bell,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

// ── 消息类型配置 ──────────────────────────────────────────────────────────────

const MSG_TYPE_CONFIG: Record<string, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ReactNode;
}> = {
  agent_forward: {
    label: "Agent 转发",
    color: "#818cf8",
    bg: "rgba(99,102,241,0.08)",
    border: "rgba(99,102,241,0.2)",
    icon: <Sparkles size={12} />,
  },
  task_remind: {
    label: "任务提醒",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    icon: <Bell size={12} />,
  },
  task_report: {
    label: "任务汇报",
    color: "#10b981",
    bg: "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.2)",
    icon: <Zap size={12} />,
  },
  system: {
    label: "系统通知",
    color: "#6b7280",
    bg: "rgba(107,114,128,0.08)",
    border: "rgba(107,114,128,0.2)",
    icon: <Bot size={12} />,
  },
};

function getTypeConfig(msgType: string) {
  return MSG_TYPE_CONFIG[msgType] ?? MSG_TYPE_CONFIG.system;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function AgentInboxPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [messages, setMessages] = useState<AgentInboxMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadMessages = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await agentInboxApi.list({ limit: 100 });
      setMessages(res.messages);
      setUnreadCount(res.unread_count);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // WebSocket 实时接收新消息
  useEffect(() => {
    if (!user) return;
    wsRef.current?.close();

    const ws = createCollabWS((data) => {
      const payload = data as { type: string; data?: AgentInboxMessage };
      if (payload.type === "agent_inbox_message" && payload.data) {
        const msg = payload.data;
        setMessages((prev) => [msg, ...prev]);
        setUnreadCount((n) => n + 1);
      }
    });
    wsRef.current = ws;
    return () => { ws?.close(); };
  }, [user]);

  const selectedMsg = messages.find((m) => m.id === selectedId) ?? null;

  // 点击消息：标记已读 + 选中
  const handleSelect = useCallback(async (msg: AgentInboxMessage) => {
    setSelectedId(msg.id);
    if (!msg.read_at) {
      try {
        await agentInboxApi.markRead(msg.id);
        setMessages((prev) =>
          prev.map((m) => m.id === msg.id ? { ...m, read_at: new Date().toISOString() } : m)
        );
        setUnreadCount((n) => Math.max(0, n - 1));
      } catch { /* 静默 */ }
    }
  }, []);

  const handleDelete = useCallback(async (msgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await agentInboxApi.delete(msgId);
      setMessages((prev) => {
        const target = prev.find((m) => m.id === msgId);
        if (target && !target.read_at) setUnreadCount((n) => Math.max(0, n - 1));
        return prev.filter((m) => m.id !== msgId);
      });
      if (selectedId === msgId) setSelectedId(null);
    } catch { /* 静默 */ }
  }, [selectedId]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await agentInboxApi.markAllRead();
      setMessages((prev) => prev.map((m) => ({ ...m, read_at: m.read_at ?? new Date().toISOString() })));
      setUnreadCount(0);
    } catch { /* 静默 */ }
  }, []);

  if (authLoading || !user) return null;

  // 过滤
  const filteredMessages = filterType === "all"
    ? messages
    : filterType === "unread"
    ? messages.filter((m) => !m.read_at)
    : messages.filter((m) => m.msg_type === filterType);

  return (
    <div style={{ display: "flex", height: "100%", backgroundColor: "var(--background)", overflow: "hidden" }}>

      {/* ── 左侧：消息列表 ── */}
      <div
        style={{
          width: "320px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border-subtle)",
          backgroundColor: "var(--sidebar-bg)",
        }}
      >
        {/* 顶部标题栏 */}
        <div
          style={{
            padding: "16px 16px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "28px", height: "28px", borderRadius: "8px",
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Inbox size={14} color="#fff" />
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                  Agent 收件箱
                </div>
                {unreadCount > 0 && (
                  <div style={{ fontSize: "11px", color: "#818cf8" }}>
                    {unreadCount} 条未读
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "4px" }}>
              {/* 全部已读 */}
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  title="全部标记为已读"
                  style={{
                    width: "26px", height: "26px", borderRadius: "6px",
                    border: "none", cursor: "pointer",
                    backgroundColor: "transparent", color: "var(--text-muted)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <CheckCheck size={13} />
                </button>
              )}
              {/* 刷新 */}
              <button
                onClick={loadMessages}
                title="刷新"
                style={{
                  width: "26px", height: "26px", borderRadius: "6px",
                  border: "none", cursor: "pointer",
                  backgroundColor: "transparent", color: "var(--text-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* 过滤 Tab */}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {[
              { key: "all", label: "全部" },
              { key: "unread", label: "未读" },
              { key: "agent_forward", label: "转发" },
              { key: "task_remind", label: "提醒" },
              { key: "task_report", label: "汇报" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterType(key)}
                style={{
                  padding: "3px 10px", borderRadius: "12px", fontSize: "11px",
                  border: filterType === key ? "1px solid #818cf8" : "1px solid var(--border-color)",
                  backgroundColor: filterType === key ? "rgba(99,102,241,0.12)" : "transparent",
                  color: filterType === key ? "#818cf8" : "var(--text-muted)",
                  cursor: "pointer", transition: "all 0.12s",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 消息列表 */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              加载中...
            </div>
          ) : filteredMessages.length === 0 ? (
            <div style={{ padding: "60px 16px", textAlign: "center" }}>
              <Inbox size={36} style={{ color: "var(--text-muted)", margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
              <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                {filterType === "unread" ? "没有未读消息" : "收件箱为空"}
              </p>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", opacity: 0.6, marginTop: "4px" }}>
                来自其他 Agent 的消息和任务提醒会出现在这里
              </p>
            </div>
          ) : (
            filteredMessages.map((msg) => (
              <InboxListItem
                key={msg.id}
                msg={msg}
                isSelected={msg.id === selectedId}
                onSelect={() => handleSelect(msg)}
                onDelete={(e) => handleDelete(msg.id, e)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── 右侧：详情面板 ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {selectedMsg ? (
          <MessageDetail msg={selectedMsg} />
        ) : (
          <div
            style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)",
            }}
          >
            <Inbox size={48} style={{ opacity: 0.2, marginBottom: "16px" }} />
            <p style={{ fontSize: "14px", opacity: 0.5 }}>选择一条消息查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 列表条目 ──────────────────────────────────────────────────────────────────

function InboxListItem({
  msg,
  isSelected,
  onSelect,
  onDelete,
}: {
  msg: AgentInboxMessage;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const cfg = getTypeConfig(msg.msg_type);
  const isUnread = !msg.read_at;
  const timeStr = new Date(msg.created_at).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  const senderName = msg.sender_display_name || msg.sender_username || "系统";

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "12px 14px",
        cursor: "pointer",
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: isSelected
          ? "rgba(99,102,241,0.1)"
          : hovered
          ? "var(--sidebar-hover)"
          : "transparent",
        borderLeft: isSelected ? "2px solid #818cf8" : "2px solid transparent",
        transition: "background 0.1s",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        {/* 类型图标 */}
        <div
          style={{
            width: "32px", height: "32px", borderRadius: "8px",
            backgroundColor: cfg.bg,
            border: `1px solid ${cfg.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, color: cfg.color,
          }}
        >
          {cfg.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 发件人 + 时间 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
            <span
              style={{
                fontSize: "12px", fontWeight: isUnread ? 600 : 400,
                color: isUnread ? "var(--text-primary)" : "var(--text-secondary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {senderName}
              {msg.sender_agent_name && (
                <span style={{ fontSize: "10px", color: cfg.color, marginLeft: "4px" }}>
                  · {msg.sender_agent_name}
                </span>
              )}
            </span>
            <span style={{ fontSize: "10px", color: "var(--text-muted)", flexShrink: 0, marginLeft: "6px" }}>
              {timeStr}
            </span>
          </div>

          {/* 标题 / 内容预览 */}
          <div
            style={{
              fontSize: "12px",
              color: isUnread ? "var(--text-primary)" : "var(--text-muted)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontWeight: isUnread ? 500 : 400,
            }}
          >
            {msg.title || msg.content.slice(0, 60)}
          </div>

          {/* 类型标签 */}
          <div style={{ marginTop: "4px" }}>
            <span
              style={{
                fontSize: "10px", padding: "1px 6px", borderRadius: "4px",
                backgroundColor: cfg.bg, color: cfg.color,
                border: `1px solid ${cfg.border}`,
              }}
            >
              {cfg.label}
            </span>
          </div>
        </div>

        {/* 未读圆点 */}
        {isUnread && (
          <div
            style={{
              width: "7px", height: "7px", borderRadius: "50%",
              backgroundColor: "#818cf8", flexShrink: 0, marginTop: "4px",
            }}
          />
        )}
      </div>

      {/* 悬停时显示删除按钮 */}
      {hovered && (
        <button
          onClick={onDelete}
          title="删除"
          style={{
            position: "absolute", bottom: "8px", right: "10px",
            width: "22px", height: "22px", borderRadius: "5px",
            border: "none", cursor: "pointer",
            backgroundColor: "rgba(239,68,68,0.1)", color: "#ef4444",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ── 详情面板 ──────────────────────────────────────────────────────────────────

function MessageDetail({ msg }: { msg: AgentInboxMessage }) {
  const cfg = getTypeConfig(msg.msg_type);
  const senderName = msg.sender_display_name || msg.sender_username || "系统";
  const timeStr = new Date(msg.created_at).toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 详情顶部 */}
      <div
        style={{
          padding: "20px 28px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {/* 类型标签 */}
        <div style={{ marginBottom: "10px" }}>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "11px", padding: "3px 10px", borderRadius: "12px",
              backgroundColor: cfg.bg, color: cfg.color,
              border: `1px solid ${cfg.border}`,
            }}
          >
            {cfg.icon}
            {cfg.label}
          </span>
        </div>

        {/* 标题 */}
        <h2
          style={{
            fontSize: "18px", fontWeight: 600, color: "var(--text-primary)",
            marginBottom: "12px", lineHeight: "1.4",
          }}
        >
          {msg.title || "（无标题）"}
        </h2>

        {/* 元信息 */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <MetaRow
            icon={<Bot size={12} />}
            label="发件方"
            value={
              <span>
                {senderName}
                {msg.sender_agent_name && (
                  <span style={{ color: cfg.color, marginLeft: "6px" }}>
                    · {msg.sender_agent_name}
                  </span>
                )}
              </span>
            }
          />
          <MetaRow
            icon={<Clock size={12} />}
            label="时间"
            value={timeStr}
          />
          <MetaRow
            icon={msg.read_at ? <MailOpen size={12} /> : <Mail size={12} />}
            label="状态"
            value={msg.read_at ? "已读" : "未读"}
          />
          {msg.task_id && (
            <MetaRow
              icon={<ChevronRight size={12} />}
              label="关联任务"
              value={
                <a
                  href="/workbench/schedule"
                  style={{ color: "#818cf8", textDecoration: "none", fontSize: "12px" }}
                >
                  查看定时任务 →
                </a>
              }
            />
          )}
        </div>
      </div>

      {/* 正文 */}
      <div
        style={{
          flex: 1, overflowY: "auto",
          padding: "24px 28px",
        }}
      >
        <div
          style={{
            fontSize: "14px", lineHeight: "1.8", color: "var(--text-primary)",
          }}
        >
          <ReactMarkdown
            components={{
              p: ({ children }) => (
                <p style={{ margin: "0 0 12px", lineHeight: "1.8" }}>{children}</p>
              ),
              h1: ({ children }) => (
                <h1 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 12px", color: "var(--text-primary)" }}>{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "16px 0 8px", color: "var(--text-primary)" }}>{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "12px 0 6px", color: "var(--text-primary)" }}>{children}</h3>
              ),
              ul: ({ children }) => (
                <ul style={{ margin: "0 0 12px", paddingLeft: "20px" }}>{children}</ul>
              ),
              li: ({ children }) => (
                <li style={{ marginBottom: "4px" }}>{children}</li>
              ),
              code: ({ children }) => (
                <code
                  style={{
                    backgroundColor: "rgba(99,102,241,0.1)",
                    padding: "1px 6px", borderRadius: "4px",
                    fontSize: "13px", fontFamily: "monospace",
                  }}
                >
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre
                  style={{
                    backgroundColor: "var(--sidebar-hover)",
                    padding: "12px 16px", borderRadius: "8px",
                    overflowX: "auto", fontSize: "13px",
                    border: "1px solid var(--border-subtle)",
                    margin: "0 0 12px",
                  }}
                >
                  {children}
                </pre>
              ),
              strong: ({ children }) => (
                <strong style={{ color: cfg.color }}>{children}</strong>
              ),
              blockquote: ({ children }) => (
                <blockquote
                  style={{
                    borderLeft: `3px solid ${cfg.color}`,
                    paddingLeft: "12px", margin: "0 0 12px",
                    color: "var(--text-muted)", fontStyle: "italic",
                  }}
                >
                  {children}
                </blockquote>
              ),
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// ── 元信息行 ──────────────────────────────────────────────────────────────────

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
      <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}>{icon}</span>
      <span style={{ color: "var(--text-muted)", minWidth: "48px" }}>{label}：</span>
      <span style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}
