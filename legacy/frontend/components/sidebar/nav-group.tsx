"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { type NavGroup } from "./nav-config";

interface NavGroupProps {
  group: NavGroup;
  collapsed: boolean;
  isFirst?: boolean;
  /** badgeKey → 未读数映射，由父组件（Sidebar）注入 */
  badges?: Record<string, number>;
}

export function NavGroupSection({ group, collapsed, isFirst, badges = {} }: NavGroupProps) {
  const [isOpen, setIsOpen] = useState(true);
  const pathname = usePathname();
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number>(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [group.items.length]);

  return (
    <div style={{ marginBottom: "4px" }}>
      {/* 分组标题 */}
      {!collapsed && (
        <button
          onClick={() => setIsOpen((v) => !v)}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            marginTop: isFirst ? "8px" : "24px",
            marginBottom: "6px",
            fontSize: "11px",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            outline: "none",
          }}
        >
          <span>{group.label}</span>
          <ChevronDown
            size={12}
            style={{
              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
              opacity: 0.5,
            }}
          />
        </button>
      )}

      {/* 菜单项列表 — max-height 展开/收起动画 */}
      <div
        style={{
          overflow: "hidden",
          maxHeight: isOpen || collapsed ? `${contentHeight || 500}px` : "0px",
          opacity: isOpen || collapsed ? 1 : 0,
          transitionProperty: "max-height, opacity",
          transitionDuration: isOpen || collapsed ? "0.28s, 0.2s" : "0.28s, 0.15s",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          ref={contentRef}
          style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "0 8px" }}
        >
          {group.items.map((item) => {
            // 精确匹配 or 前缀匹配（但要排除被其他更长 href 覆盖的情况）
            const exactMatch = pathname === item.href;
            const prefixMatch = item.href !== "/" && pathname.startsWith(item.href + "/");
            // 检查同组内是否有更精确的匹配项（更长的 href）
            const hasBetterMatch = group.items.some(
              (other) =>
                other.href !== item.href &&
                other.href.length > item.href.length &&
                (pathname === other.href || pathname.startsWith(other.href + "/"))
            );
            const isActive = (exactMatch || prefixMatch) && !hasBetterMatch;
            const Icon = item.icon;
            const badgeCount = item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: isActive ? 500 : 400,
                  textDecoration: "none",
                  backgroundColor: isActive ? "var(--sidebar-active)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  outline: "none",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-hover)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                  }
                }}
              >
                {/* 图标（折叠时显示角标在图标右上角） */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <Icon
                    size={16}
                    style={{
                      color: isActive ? "var(--accent-blue)" : "currentColor",
                      opacity: isActive ? 1 : 0.65,
                    }}
                  />
                  {collapsed && badgeCount > 0 && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-5px",
                        right: "-5px",
                        minWidth: "14px",
                        height: "14px",
                        borderRadius: "7px",
                        backgroundColor: "#ef4444",
                        color: "#fff",
                        fontSize: "9px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 3px",
                        boxShadow: "0 0 0 2px var(--sidebar-bg)",
                      }}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </div>

                {!collapsed && (
                  <>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                    {/* 展开时角标显示在文字右侧 */}
                    {badgeCount > 0 && (
                      <span
                        style={{
                          minWidth: "18px",
                          height: "18px",
                          borderRadius: "9px",
                          backgroundColor: "#ef4444",
                          color: "#fff",
                          fontSize: "10px",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 4px",
                          flexShrink: 0,
                        }}
                      >
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
