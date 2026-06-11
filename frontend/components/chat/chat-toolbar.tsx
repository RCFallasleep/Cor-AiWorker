"use client";

import { useState } from "react";
import {
  ChevronDown,
  RefreshCw,
  Download,
  Wrench,
  Scan,
  User,
  SquarePen,
  StopCircle,
  Key,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { getProviderLabel } from "@/lib/providers-config";
import type { AvailableModel } from "@/lib/hooks/use-available-models";
import type { ConversationRow } from "@/lib/db/idb";

// ── 会话选择器（替代原 branch 选择器）──
function ConversationSelector({
  currentId,
  conversations,
  onChange,
}: {
  currentId: string | null;
  conversations: ConversationRow[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = conversations.find((c) => c.id === currentId);
  const label = current
    ? (current.title.length > 20 ? current.title.slice(0, 20) + "…" : current.title)
    : "新对话";

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 10px",
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px", color: "var(--text-primary)",
          fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", outline: "none",
          maxWidth: "200px",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <ChevronDown size={13} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20,
              backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)",
              borderRadius: "10px", padding: "4px", minWidth: "220px", maxWidth: "300px",
              maxHeight: "320px", overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {/* 新对话选项 */}
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                width: "100%", textAlign: "left",
                padding: "7px 10px", borderRadius: "6px", border: "none",
                backgroundColor: currentId === null ? "var(--sidebar-active)" : "transparent",
                color: currentId === null ? "var(--accent-blue)" : "var(--text-secondary)",
                fontSize: "13px", cursor: "pointer", outline: "none",
                fontStyle: "italic",
              }}
            >
              <SquarePen size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
              <span>新对话</span>
            </button>

            {/* 分隔线（有历史时才显示）*/}
            {conversations.length > 0 && (
              <div style={{ height: "1px", backgroundColor: "var(--border-subtle)", margin: "4px 0" }} />
            )}

            {/* 历史会话列表 */}
            {conversations.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--text-muted)", textAlign: "center" }}>
                暂无历史对话
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => { onChange(conv.id); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    width: "100%", textAlign: "left",
                    padding: "7px 10px", borderRadius: "6px", border: "none",
                    backgroundColor: conv.id === currentId ? "var(--sidebar-active)" : "transparent",
                    color: conv.id === currentId ? "var(--accent-blue)" : "var(--text-primary)",
                    fontSize: "13px", cursor: "pointer", outline: "none",
                  }}
                >
                  <MessageSquare size={13} style={{ flexShrink: 0, opacity: 0.5 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {conv.title}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 模型选择器（只显示有激活 Key 的 Provider 分组）──
function ModelSelector({
  value,
  models,
  onChange,
  loading,
}: {
  value: string;
  models: AvailableModel[];
  onChange: (id: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);

  // models 已经是从 SQLite 激活 Key 生成的，直接使用
  const availableModels = models;
  const current = availableModels.find((m) => m.id === value) ?? availableModels[0];
  const hasAnyKey = availableModels.length > 0;

  // 按 provider 分组（只含有 Key 的）
  const grouped = availableModels.reduce<Record<string, AvailableModel[]>>((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});

  // 保持 provider 顺序
  const providerOrder = ["anthropic", "openai", "deepseek", "gemini", "custom"];
  const visibleProviders = providerOrder.filter((p) => grouped[p]?.length);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 10px",
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          color: hasAnyKey ? "var(--text-primary)" : "var(--text-muted)",
          fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", outline: "none",
        }}
      >
        <span>
          {loading ? "加载中..." : hasAnyKey ? (current?.label ?? "选择模型") : "无可用模型"}
        </span>
        <ChevronDown size={13} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20,
              backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)",
              borderRadius: "10px", padding: "6px",
              minWidth: "220px", maxHeight: "360px", overflowY: "auto",
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {/* 无任何 Key 时的空状态 */}
            {!hasAnyKey && (
              <div style={{ padding: "12px 10px", textAlign: "center" }}>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 8px" }}>
                  尚未配置任何 API Key
                </p>
                <Link
                  href="/settings/apikey"
                  onClick={() => setOpen(false)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    fontSize: "12px", color: "var(--accent-blue)", textDecoration: "none",
                  }}
                >
                  <Key size={11} /> 前往添加 Key
                </Link>
              </div>
            )}

            {/* 按 provider 分组，只渲染有 Key 的组 */}
            {visibleProviders.map((provider, idx) => {
              const group = grouped[provider];
              const isLast = idx === visibleProviders.length - 1;
              return (
                <div key={provider}>
                  {/* Provider 标题（使用共享配置的 label）*/}
                  <div style={{ padding: "4px 10px 2px" }}>
                    <span style={{
                      fontSize: "11px", color: "var(--text-muted)",
                      fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>
                      {getProviderLabel(provider)}
                    </span>
                  </div>

                  {/* 模型列表 */}
                  {group.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { onChange(m.id); setOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", textAlign: "left",
                        padding: "7px 10px", borderRadius: "6px", border: "none",
                        backgroundColor: m.id === value ? "var(--sidebar-active)" : "transparent",
                        color: m.id === value ? "var(--accent-blue)" : "var(--text-primary)",
                        fontSize: "13px", cursor: "pointer", outline: "none",
                      }}
                    >
                      <span>{m.label}</span>
                      {m.supportsVision && (
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>视觉</span>
                      )}
                    </button>
                  ))}

                  {/* 分组间分隔线（最后一组不加）*/}
                  {!isLast && (
                    <div style={{ height: "1px", backgroundColor: "var(--border-subtle)", margin: "4px 0" }} />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── 右侧图标按钮 ──
function ToolBtn({
  children,
  title,
  badge,
  active,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "34px", height: "34px", borderRadius: "8px",
        border: active ? "1px solid var(--accent-blue)" : "1px solid transparent",
        backgroundColor: active
          ? "rgba(59,130,246,0.15)"
          : hovered ? "var(--sidebar-hover)" : "transparent",
        color: active ? "var(--accent-blue)" : hovered ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer", outline: "none", flexShrink: 0,
      }}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            position: "absolute", top: "2px", right: "2px",
            width: "14px", height: "14px", borderRadius: "50%",
            backgroundColor: "var(--accent-blue)", color: "#fff",
            fontSize: "9px", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ── 分隔线 ──
function Divider() {
  return (
    <div style={{ width: "1px", height: "20px", backgroundColor: "var(--border-color)", flexShrink: 0 }} />
  );
}

// ── 主组件 ──
export function ChatToolbar({
  conversationId,
  conversations,
  onConversationChange,
  modelId,
  onModelChange,
  streaming = false,
  onAbort,
  onNewConversation,
}: {
  conversationId: string | null;
  conversations: ConversationRow[];
  onConversationChange: (id: string | null) => void;
  modelId: string;
  onModelChange: (m: string) => void;
  streaming?: boolean;
  onAbort?: () => void;
  onNewConversation?: () => void;
}) {
  const { models, loading } = useAvailableModels();

  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px",
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: "var(--topbar-bg)",
        flexShrink: 0, gap: "8px",
      }}
    >
      {/* 左侧：新对话按钮 + 会话选择器 + 模型选择 */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <ToolBtn title="新对话" onClick={onNewConversation}>
          <SquarePen size={15} />
        </ToolBtn>
        <ConversationSelector
          currentId={conversationId}
          conversations={conversations}
          onChange={onConversationChange}
        />
        <ModelSelector
          value={modelId}
          models={models}
          onChange={onModelChange}
          loading={loading}
        />

        {/* 流式输出中：显示中止按钮 */}
        {streaming && (
          <ToolBtn title="停止生成" onClick={onAbort}>
            <StopCircle size={15} style={{ color: "#ef4444" }} />
          </ToolBtn>
        )}
      </div>

      {/* 右侧：工具按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <ToolBtn title="刷新上下文">
          <RefreshCw size={15} />
        </ToolBtn>
        <Divider />
        <ToolBtn title="下载对话" active>
          <Download size={15} />
        </ToolBtn>
        <ToolBtn title="工具 / MCP">
          <Wrench size={15} />
        </ToolBtn>
        <ToolBtn title="截图">
          <Scan size={15} />
        </ToolBtn>
        <ToolBtn title="用户" badge={3}>
          <User size={15} />
        </ToolBtn>
      </div>
    </div>
  );
}
