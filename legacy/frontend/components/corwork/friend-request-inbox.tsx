"use client";

import { useEffect, useState, useCallback } from "react";
import { collabApi, type FriendRequest } from "@/lib/api/client";
import { UserCheck, UserX, Bot, X } from "lucide-react";

interface Props {
  onClose: () => void;
  /** 同意后刷新会话列表 */
  onAccepted?: () => void;
}

export default function FriendRequestInbox({ onClose, onAccepted }: Props) {
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await collabApi.listPendingRequests();
      setRequests(list);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAction = async (req: FriendRequest, action: "accept" | "reject") => {
    setProcessing(req.id);
    try {
      await collabApi.handleFriendRequest(req.id, action);
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      if (action === "accept") onAccepted?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "操作失败");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 190 }}
        onClick={onClose}
      />

      {/* 面板 */}
      <div
        style={{
          position: "absolute",
          top: "52px",
          left: "calc(100% + 8px)",
          zIndex: 200,
          width: "300px",
          backgroundColor: "var(--sidebar-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "14px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            好友申请
          </span>
          <button
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "24px", height: "24px", borderRadius: "6px",
              border: "none", cursor: "pointer",
              backgroundColor: "transparent", color: "var(--text-muted)",
              outline: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--sidebar-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* 内容 */}
        <div style={{ maxHeight: "360px", overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              加载中...
            </div>
          ) : requests.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center" }}>
              <UserCheck size={32} style={{ color: "var(--text-muted)", opacity: 0.3, margin: "0 auto 10px", display: "block" }} />
              <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>暂无待处理申请</p>
            </div>
          ) : (
            requests.map((req) => (
              <RequestItem
                key={req.id}
                req={req}
                processing={processing === req.id}
                onAccept={() => handleAction(req, "accept")}
                onReject={() => handleAction(req, "reject")}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── 单条申请 ──────────────────────────────────────────────────────────────────

function RequestItem({
  req,
  processing,
  onAccept,
  onReject,
}: {
  req: FriendRequest;
  processing: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const name = req.from_display_name || req.from_username;

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: "10px",
        padding: "12px 16px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {/* 头像 */}
      <div
        style={{
          width: "38px", height: "38px", borderRadius: "50%",
          backgroundColor: req.from_agent_name ? "#7c3aed" : "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, fontSize: "14px", fontWeight: 700, color: "#fff",
        }}
      >
        {req.from_agent_name ? <Bot size={16} color="#fff" /> : name[0]?.toUpperCase()}
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "1px" }}>
          {name}
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: req.message ? "6px" : "8px" }}>
          @{req.from_username}
          {req.from_agent_name && ` · ${req.from_agent_name}`}
        </div>
        {req.message && (
          <div
            style={{
              fontSize: "12px", color: "var(--text-secondary)",
              backgroundColor: "var(--sidebar-hover)",
              borderRadius: "6px", padding: "5px 8px",
              marginBottom: "8px",
              wordBreak: "break-word",
            }}
          >
            {req.message}
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            onClick={onAccept}
            disabled={processing}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              padding: "6px 0", borderRadius: "7px",
              border: "none", cursor: processing ? "not-allowed" : "pointer",
              backgroundColor: "var(--accent)", color: "#fff",
              fontSize: "12px", fontWeight: 500,
              opacity: processing ? 0.6 : 1,
            }}
          >
            <UserCheck size={12} />
            同意
          </button>
          <button
            onClick={onReject}
            disabled={processing}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
              padding: "6px 0", borderRadius: "7px",
              border: "1px solid var(--border-color)", cursor: processing ? "not-allowed" : "pointer",
              backgroundColor: "transparent", color: "var(--text-muted)",
              fontSize: "12px",
              opacity: processing ? 0.6 : 1,
            }}
          >
            <UserX size={12} />
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
