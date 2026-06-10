"use client";

import { usePathname } from "next/navigation";
import { Sun, Moon, Bell, Settings, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { navGroups } from "@/components/sidebar/nav-config";
import { useTheme } from "@/contexts/theme-context";

function useBreadcrumb() {
  const pathname = usePathname();
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.href === pathname) {
        return { group: group.label, page: item.label, Icon: item.icon };
      }
    }
  }
  return { group: null, page: null, Icon: null };
}

// 苹果风格 Sun/Moon 滑动 Toggle（接入真实主题）
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        backgroundColor: "var(--sidebar-hover)",
        borderRadius: "10px",
        padding: "3px",
        gap: "2px",
        border: "1px solid var(--border-color)",
        position: "relative",
      }}
    >
      {/* 滑动背景块 */}
      <div
        style={{
          position: "absolute",
          top: "3px",
          left: isDark ? "calc(50% + 1px)" : "3px",
          width: "calc(50% - 4px)",
          height: "calc(100% - 6px)",
          backgroundColor: "var(--border-color)",
          borderRadius: "7px",
          transition: "left 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
          pointerEvents: "none",
        }}
      />

      {/* Sun 按钮 */}
      <button
        onClick={() => isDark && toggleTheme()}
        title="亮色模式"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "26px",
          borderRadius: "7px",
          border: "none",
          cursor: "pointer",
          backgroundColor: "transparent",
          color: !isDark ? "#f59e0b" : "var(--text-muted)",
          outline: "none",
          zIndex: 1,
        }}
      >
        <Sun size={14} />
      </button>

      {/* Moon 按钮 */}
      <button
        onClick={() => !isDark && toggleTheme()}
        title="暗色模式"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "26px",
          borderRadius: "7px",
          border: "none",
          cursor: "pointer",
          backgroundColor: "transparent",
          color: isDark ? "#60a5fa" : "var(--text-muted)",
          outline: "none",
          zIndex: 1,
        }}
      >
        <Moon size={14} />
      </button>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "8px",
        border: "none",
        cursor: "pointer",
        backgroundColor: hovered ? "var(--sidebar-hover)" : "transparent",
        color: hovered ? "var(--text-primary)" : "var(--text-secondary)",
        outline: "none",
      }}
    >
      {children}
    </button>
  );
}

export function Topbar() {
  const { group, page, Icon } = useBreadcrumb();
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 900);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "60px",
        padding: "0 16px",
        flexShrink: 0,
        backgroundColor: "var(--topbar-bg)",
        borderBottom: "1px solid var(--border-subtle)",
        minWidth: 0,
      }}
    >
      {/* 左侧：面包屑 */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden", minWidth: 0 }}>
        <img src="/logo.svg" alt="logo" style={{ width: "16px", height: "16px", flexShrink: 0, opacity: 0.6 }} />

        {/* 宽屏：完整面包屑；窄屏：只显示当前页 */}
        {!isNarrow && (
          <span style={{ fontSize: "13px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            Cor-AiWorker
          </span>
        )}

        {!isNarrow && group && (
          <>
            <ChevronRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0, opacity: 0.5 }} />
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{group}</span>
          </>
        )}

        {page && (
          <>
            {!isNarrow && (
              <ChevronRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0, opacity: 0.5 }} />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "5px", overflow: "hidden" }}>
              {Icon && <Icon size={13} style={{ color: "var(--text-primary)", flexShrink: 0 }} />}
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--text-primary)",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {page}
              </span>
            </div>
          </>
        )}
      </div>

      {/* 右侧：操作区 */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        <ThemeToggle />
        <IconButton title="通知">
          <Bell size={15} />
        </IconButton>
        <IconButton title="设置">
          <Settings size={15} />
        </IconButton>
      </div>
    </header>
  );
}
