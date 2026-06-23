"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MessageCircle,
  FolderKanban,
  LayoutDashboard,
  Inbox,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { agentInboxApi, createCollabWS } from "@/lib/api/client";

interface CorworkTab {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  badgeKey?: string;
}

const TABS: CorworkTab[] = [
  {
    id: "messages",
    label: "消息",
    href: "/corwork/messages",
    icon: <MessageCircle size={20} strokeWidth={1.8} />,
  },
  {
    id: "agent-inbox",
    label: "收件箱",
    href: "/corwork/agent-inbox",
    icon: <Inbox size={20} strokeWidth={1.8} />,
    badgeKey: "agent_inbox",
  },
  {
    id: "projects",
    label: "项目",
    href: "/corwork/projects",
    icon: <FolderKanban size={20} strokeWidth={1.8} />,
  },
  {
    id: "board",
    label: "协作看板",
    href: "/corwork/board",
    icon: <LayoutDashboard size={20} strokeWidth={1.8} />,
  },
];

export function CorworkSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // 动态角标：badgeKey → 未读数
  const [badges, setBadges] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  // 拉取 Agent 收件箱未读数
  const fetchInboxUnread = useCallback(async () => {
    if (!user) return;
    try {
      const { unread_count } = await agentInboxApi.unreadCount();
      setBadges((prev) => ({ ...prev, agent_inbox: unread_count }));
    } catch { /* 静默 */ }
  }, [user]);

  useEffect(() => {
    fetchInboxUnread();
  }, [fetchInboxUnread]);

  // WebSocket 实时监听新收件箱消息
  useEffect(() => {
    if (!user) return;
    wsRef.current?.close();

    const ws = createCollabWS((data) => {
      const payload = data as { type: string };
      if (payload.type === "agent_inbox_message") {
        setBadges((prev) => ({
          ...prev,
          agent_inbox: (prev.agent_inbox ?? 0) + 1,
        }));
      }
    });
    wsRef.current = ws;
    return () => { ws?.close(); };
  }, [user]);

  // 进入收件箱页面时清零角标（已在页面内标记已读）
  useEffect(() => {
    if (pathname.startsWith("/corwork/agent-inbox")) {
      // 延迟一点，等页面加载完成后再清零
      const timer = setTimeout(() => {
        setBadges((prev) => ({ ...prev, agent_inbox: 0 }));
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  // 只在 /corwork 路径下显示（think-tank 除外）
  const isCorwork = pathname.startsWith("/corwork") && !pathname.startsWith("/corwork/think-tank");
  if (!isCorwork) return null;

  const getActiveId = () => {
    for (const tab of TABS) {
      if (pathname === tab.href || pathname.startsWith(tab.href + "/")) return tab.id;
    }
    if (pathname === "/corwork") return "messages";
    return null;
  };

  const activeId = getActiveId();

  return (
    // 外层容器：相对定位，用于让拉手按钮能 absolute 定位到右边缘
    <div style={{ position: "relative", flexShrink: 0 }}>
      {/* 主体侧边栏 */}
      <aside
        style={{
          width: collapsed ? "0px" : "68px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: collapsed ? 0 : "16px",
          paddingBottom: collapsed ? 0 : "12px",
          gap: "2px",
          backgroundColor: "#0d0d0d",
          borderRight: collapsed ? "none" : "1px solid var(--border-subtle)",
          overflow: "hidden",
          transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s ease",
        }}
      >
        {/* 顶部：用户头像（点击弹出卡片） */}
        <button
          onClick={() => setShowLogoutConfirm((v) => !v)}
          title={user?.display_name || user?.username || ""}
          style={{
            width: "36px", height: "36px", borderRadius: "50%",
            backgroundColor: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "13px", fontWeight: 700, color: "#fff",
            flexShrink: 0, cursor: "pointer",
            border: "2px solid transparent",
            outline: "none",
            marginBottom: "8px",
            transition: "border-color 0.15s, box-shadow 0.15s",
            boxShadow: showLogoutConfirm ? "0 0 0 2px var(--accent)" : "0 0 0 2px rgba(255,255,255,0.08)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
        >
          {(user?.display_name || user?.username || "?")[0]?.toUpperCase()}
        </button>

        {/* Tab 列表 */}
        {TABS.map((tab, idx) => {
          const isActive = activeId === tab.id;
          const isHovered = hoveredId === tab.id;
          const badgeCount = tab.badgeKey ? (badges[tab.badgeKey] ?? 0) : 0;
          const showBadge = badgeCount > 0;

          // 「收件箱」和「项目」之间加一条分割线
          const showDivider = idx > 0 && TABS[idx - 1].id === "agent-inbox";

          return (
            <div key={tab.id} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {showDivider && (
                <div
                  style={{
                    width: "32px", height: "1px",
                    backgroundColor: "var(--border-subtle)",
                    margin: "4px 0",
                    opacity: 0.5,
                  }}
                />
              )}
              <button
                onClick={() => router.push(tab.href)}
                onMouseEnter={() => setHoveredId(tab.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={tab.label}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  width: "52px",
                  minHeight: "52px",
                  padding: "8px 4px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  outline: "none",
                  transition: "background-color 0.15s ease",
                  backgroundColor: isActive
                    ? "var(--sidebar-active)"
                    : isHovered
                    ? "var(--sidebar-hover)"
                    : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {/* 激活左侧指示条 */}
                {isActive && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: "3px",
                      height: "20px",
                      borderRadius: "0 3px 3px 0",
                      backgroundColor: "var(--accent)",
                    }}
                  />
                )}

                {/* 图标 + 角标 */}
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", opacity: isActive ? 1 : 0.6 }}>
                  {tab.icon}
                  {showBadge && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-5px",
                        right: "-7px",
                        minWidth: "15px",
                        height: "15px",
                        padding: "0 3px",
                        borderRadius: "8px",
                        backgroundColor: "#f53f3f",
                        color: "#fff",
                        fontSize: "9px",
                        fontWeight: 700,
                        lineHeight: "15px",
                        textAlign: "center",
                        boxSizing: "border-box",
                        boxShadow: "0 0 0 2px #0d0d0d",
                      }}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </div>

                {/* 文字标签 */}
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: isActive ? 600 : 400,
                    lineHeight: 1,
                    whiteSpace: "nowrap",
                    color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {tab.label}
                </span>
              </button>
            </div>
          );
        })}
      </aside>

      {/* 用户卡片 popup（absolute 定位，贴着侧边栏右侧、底部对齐） */}
      {showLogoutConfirm && (
        <>
          {/* 点击外部关闭 */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 290 }}
            onClick={() => setShowLogoutConfirm(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "8px",
              left: "calc(100% + 8px)",
              zIndex: 300,
              width: "200px",
              backgroundColor: "var(--sidebar-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            {/* 用户信息 */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <div
                style={{
                  width: "36px", height: "36px", borderRadius: "50%",
                  backgroundColor: "var(--accent)", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "14px", fontWeight: 700, color: "#fff",
                }}
              >
                {(user?.display_name || user?.username || "?")[0]?.toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user?.display_name || user?.username}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  @{user?.username}
                </div>
              </div>
            </div>

            {/* 分割线 */}
            <div style={{ height: "1px", backgroundColor: "var(--border-subtle)", marginBottom: "10px" }} />

            {/* 退出登录 */}
            <button
              onClick={() => { logout(); router.replace("/login"); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 10px", borderRadius: "8px",
                border: "none", cursor: "pointer",
                backgroundColor: "transparent", color: "#ef4444",
                fontSize: "13px", textAlign: "left",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <LogOut size={14} />
              退出登录
            </button>
          </div>
        </>
      )}

      {/* 折叠/展开拉手 — 贴在侧边栏右边缘，垂直居中 */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "展开协作栏" : "收起协作栏"}
        style={{
          position: "absolute",
          right: collapsed ? "-20px" : "-12px",
          bottom: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "20px",
          height: "36px",
          borderRadius: "0 6px 6px 0",
          border: "1px solid var(--border-subtle)",
          borderLeft: "none",
          cursor: "pointer",
          backgroundColor: "#0d0d0d",
          color: "var(--text-muted)",
          outline: "none",
          zIndex: 20,
          transition: "right 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s ease",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>
    </div>
  );
}
