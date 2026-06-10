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
}

export function NavGroupSection({ group, collapsed, isFirst }: NavGroupProps) {
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
            const isActive = pathname === item.href;
            const Icon = item.icon;

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
                <Icon
                  size={16}
                  style={{
                    flexShrink: 0,
                    color: isActive ? "var(--accent-blue)" : "currentColor",
                    opacity: isActive ? 1 : 0.65,
                  }}
                />
                {!collapsed && (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
