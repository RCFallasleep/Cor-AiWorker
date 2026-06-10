"use client";

import { useState, useEffect, useCallback } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { navGroups } from "./nav-config";
import { NavGroupSection } from "./nav-group";

const AUTO_COLLAPSE_WIDTH = 900; // 小于此宽度自动折叠

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  // 记录用户是否手动操作过，手动操作后不再自动响应
  const [userOverride, setUserOverride] = useState(false);

  const handleResize = useCallback(() => {
    if (userOverride) return;
    if (window.innerWidth < AUTO_COLLAPSE_WIDTH) {
      setCollapsed(true);
    } else {
      setCollapsed(false);
    }
  }, [userOverride]);

  useEffect(() => {
    // 初始化时检查一次
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  // 用户手动点击折叠按钮
  const handleToggle = () => {
    setUserOverride(true);
    setCollapsed((v) => !v);
  };

  // 窗口恢复到宽屏时，重置 override，让自动逻辑重新接管
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= AUTO_COLLAPSE_WIDTH) {
        setUserOverride(false);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: collapsed ? "60px" : "240px",
        flexShrink: 0,
        backgroundColor: "var(--sidebar-bg)",
        borderRight: "none",
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        overflow: "hidden",
      }}
    >
      {/* 顶部 Logo 区域 */}
      <div
        style={{
          display: "flex",
          height: "60px",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
            <img src="/logo.svg" alt="logo" style={{ width: "22px", height: "22px", flexShrink: 0 }} />
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Cor-AiWorker
            </span>
          </div>
        )}
        {collapsed && (
          <img src="/logo.svg" alt="logo" style={{ width: "22px", height: "22px", margin: "0 auto" }} />
        )}

        <button
          onClick={handleToggle}
          title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            flexShrink: 0,
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            backgroundColor: "var(--sidebar-hover)",
            color: "var(--text-secondary)",
            outline: "none",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.filter = "brightness(1.3)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.filter = "none";
          }}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* 导航菜单 */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {navGroups.map((group, index) => (
          <NavGroupSection
            key={group.id}
            group={group}
            collapsed={collapsed}
            isFirst={index === 0}
          />
        ))}
      </nav>

      {/* 底部状态栏 */}
      <div style={{ borderTop: "1px solid var(--border-color)", padding: "12px", flexShrink: 0 }}>
        {collapsed ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--online-green)" }} />
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>v0.1.0-alpha</span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--online-green)" }} />
              <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>在线</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
