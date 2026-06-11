"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Trash2, Loader2, RefreshCw,
  Search, ExternalLink, Eye,
} from "lucide-react";
import { conversationRepo, type ConversationRow } from "@/lib/repositories/conversation-repository";

// ── 时间格式化 ──
function formatRelative(ts: number): string {
  const diffMs  = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);
  if (diffMin < 1)  return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffH   < 24) return `${diffH} 小时前`;
  if (diffD   < 7)  return `${diffD} 天前`;
  return formatAbsolute(ts);
}

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

// ── 表格行 ──
function ConvRow({
  conv,
  onDelete,
}: {
  conv: ConversationRow;
  onDelete: (id: string) => void;
}) {
  const router  = useRouter();
  const [hovered,  setHovered]  = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleRowClick = () => {
    router.push(`/chat?id=${conv.id}`);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/chat/history/${conv.id}`);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    await conversationRepo.deleteConversation(conv.id);
    onDelete(conv.id);
  };

  return (
    <tr
      onClick={handleRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: "pointer",
        backgroundColor: hovered ? "var(--sidebar-hover)" : "transparent",
        transition: "background-color 0.1s ease",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {/* 会话名 */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle", minWidth: "180px", maxWidth: "260px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <MessageSquare size={14} style={{ color: "var(--accent-blue)", flexShrink: 0, opacity: 0.7 }} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: "13px", fontWeight: 500, color: "var(--text-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {conv.title}
            </div>
          </div>
        </div>
      </td>

      {/* Agent（mock: main，后续接入真实 Agent） */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        <span
          style={{
            display: "inline-block",
            fontSize: "11px", fontWeight: 500,
            color: "var(--accent-blue)",
            backgroundColor: "rgba(59,130,246,0.12)",
            padding: "2px 8px", borderRadius: "20px",
            border: "1px solid rgba(59,130,246,0.2)",
          }}
        >
          main
        </span>
      </td>

      {/* 预览 */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
        <span
          style={{
            fontSize: "12px", color: "var(--text-secondary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "block", maxWidth: "420px",
          }}
        >
          {conv.lastPreview || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>暂无预览</span>}
        </span>
      </td>

      {/* 消息数 */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle", textAlign: "center", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {conv.messageCount}
        </span>
      </td>

      {/* 最后活跃 */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {formatRelative(conv.updatedAt)}
        </span>
      </td>

      {/* 开始时间 */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {formatAbsolute(conv.createdAt)}
        </span>
      </td>

      {/* 操作 */}
      <td style={{ padding: "12px 16px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.15s ease",
          }}
        >
          {/* 查看详情（只读消息列表） */}
          <button
            onClick={handleView}
            title="查看对话记录"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "26px", height: "26px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-active)";
              (e.currentTarget as HTMLElement).style.color = "var(--accent-blue)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            }}
          >
            <Eye size={13} />
          </button>

          {/* 在 Chat 中打开 */}
          <button
            onClick={handleRowClick}
            title="在聊天中打开"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "26px", height: "26px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-active)";
              (e.currentTarget as HTMLElement).style.color = "var(--accent-blue)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
            }}
          >
            <ExternalLink size={13} />
          </button>

          {/* 删除 */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="删除对话"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "26px", height: "26px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: deleting ? "var(--text-muted)" : "#ef4444",
              cursor: deleting ? "not-allowed" : "pointer", outline: "none",
            }}
            onMouseEnter={(e) => {
              if (!deleting) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(239,68,68,0.1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
            }}
          >
            {deleting
              ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              : <Trash2 size={13} />
            }
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── 主页面 ──
export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [query,         setQuery]         = useState("");
  const [totalMessages, setTotalMessages] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await conversationRepo.listConversations();
    setConversations(list);
    setTotalMessages(list.reduce((s, c) => s + c.messageCount, 0));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = (id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setTotalMessages(next.reduce((s, c) => s + c.messageCount, 0));
      return next;
    });
  };

  // 客户端模糊搜索（标题 + 预览）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.lastPreview.toLowerCase().includes(q)
    );
  }, [conversations, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 页头 */}
      <div
        style={{
          padding: "24px 28px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 4px" }}>
          聊天记录
        </h1>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 16px" }}>
          浏览和搜索所有历史聊天记录。
        </p>

        {/* 搜索框 */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              flex: 1, display: "flex", alignItems: "center", gap: "8px",
              padding: "8px 12px",
              backgroundColor: "var(--card-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
            }}
          >
            <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="搜索会话名称或内容..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1, border: "none", outline: "none",
                backgroundColor: "transparent",
                fontSize: "13px", color: "var(--text-primary)",
              }}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                style={{
                  border: "none", backgroundColor: "transparent",
                  color: "var(--text-muted)", cursor: "pointer",
                  fontSize: "14px", lineHeight: 1, padding: 0, outline: "none",
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* 刷新 */}
          <button
            onClick={load}
            title="刷新"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "36px", height: "36px", borderRadius: "8px",
              border: "1px solid var(--border-color)",
              backgroundColor: "var(--card-bg)",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
              flexShrink: 0,
            }}
          >
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
          </button>
        </div>

        {/* 统计行 */}
        {!loading && (
          <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {filtered.length !== conversations.length
                ? `${filtered.length} / ${conversations.length} 个会话`
                : `${conversations.length} 个会话`}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>·</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{totalMessages} 条消息</span>
          </div>
        )}
      </div>

      {/* 表格区域 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", gap: "8px", color: "var(--text-muted)" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: "13px" }}>加载中...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "260px", gap: "12px",
            }}
          >
            <MessageSquare size={36} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
              {query ? `未找到包含「${query}」的会话` : "还没有对话记录"}
            </p>
            {!query && (
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                去 Chat 页面开始第一段对话吧
              </p>
            )}
          </div>
        ) : (
          <table
            style={{
              width: "100%", borderCollapse: "collapse",
              fontSize: "13px",
            }}
          >
            {/* 表头 */}
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                {[
                  { label: "会话",   width: "auto" },
                  { label: "AGENT",  width: "90px" },
                  { label: "预览",   width: "auto" },
                  { label: "消息数", width: "70px" },
                  { label: "最后活跃", width: "100px" },
                  { label: "开始时间", width: "120px" },
                  { label: "",       width: "100px" },
                ].map((col) => (
                  <th
                    key={col.label}
                    style={{
                      padding: "10px 16px",
                      textAlign: col.label === "消息数" ? "center" : "left",
                      fontSize: "11px", fontWeight: 600,
                      color: "var(--text-muted)",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                      width: col.width,
                      position: "sticky", top: 0,
                      backgroundColor: "var(--background)",
                      zIndex: 1,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            {/* 表体 */}
            <tbody>
              {filtered.map((conv) => (
                <ConvRow key={conv.id} conv={conv} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input::placeholder { color: var(--text-muted); }
      `}</style>
    </div>
  );
}
