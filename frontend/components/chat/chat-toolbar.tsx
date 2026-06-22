"use client";

import { useState, useEffect } from "react";
import {
  ChevronDown,
  RefreshCw,
  Download,
  Wrench,
  Scan,
  User,
  SquarePen,
  StopCircle,
  MessageSquare,
  Sparkles,
  BrainCircuit,
  PenLine,
  ShieldCheck,
  Zap,
  BookOpen,
  Globe,
  Code2,
  Search as SearchIcon,
  Plus,
  Loader2,
  Scissors,
} from "lucide-react";
import Link from "next/link";
import { agentRepo } from "@/lib/repositories/agent-repository";
import type { AgentRow, ConversationRow } from "@/lib/db/idb";

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

// ── Agent 图标映射 ──
const AGENT_ICON_MAP: Record<string, React.ReactNode> = {
  Search:       <SearchIcon size={14} />,
  BrainCircuit: <BrainCircuit size={14} />,
  PenLine:      <PenLine size={14} />,
  ShieldCheck:  <ShieldCheck size={14} />,
  Sparkles:     <Sparkles size={14} />,
  Zap:          <Zap size={14} />,
  BookOpen:     <BookOpen size={14} />,
  Globe:        <Globe size={14} />,
  Code2:        <Code2 size={14} />,
};

// ── Agent 选择器 ──
function AgentSelector({
  value,
  onChange,
}: {
  value: string;        // AgentRow.id，空字符串表示未选择
  onChange: (agent: AgentRow | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentRepo.list().then((list) => {
      setAgents(list);
      setLoading(false);
    });
  }, []);

  const current = agents.find((a) => a.id === value) ?? null;
  const hasAgents = agents.length > 0;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "5px 10px",
          backgroundColor: current ? "rgba(99,102,241,0.1)" : "var(--card-bg)",
          border: `1px solid ${current ? "rgba(99,102,241,0.35)" : "var(--border-color)"}`,
          borderRadius: "8px",
          color: current ? "#818cf8" : "var(--text-muted)",
          fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", outline: "none",
          transition: "all 0.15s",
        }}
      >
        {current ? (
          <>
            {/* Agent 图标小圆 */}
            <span style={{
              width: "18px", height: "18px", borderRadius: "5px",
              backgroundColor: current.iconColor,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.9)", flexShrink: 0,
            }}>
              {AGENT_ICON_MAP[current.iconName] ?? <Sparkles size={11} />}
            </span>
            <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis" }}>
              {current.name}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>
            {loading ? "加载中..." : "选择 Agent"}
          </span>
        )}
        <ChevronDown size={13} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20,
            backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)",
            borderRadius: "10px", padding: "6px",
            minWidth: "240px", maxHeight: "360px", overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}>
            {/* 标题 */}
            <div style={{ padding: "4px 10px 6px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                选择 Agent
              </span>
            </div>

            {/* 无 Agent 时的空状态 */}
            {!hasAgents && !loading && (
              <div style={{ padding: "12px 10px", textAlign: "center" }}>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "0 0 8px" }}>
                  还没有创建 Agent
                </p>
                <Link
                  href="/health/agent"
                  onClick={() => setOpen(false)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    fontSize: "12px", color: "var(--accent-blue)", textDecoration: "none",
                  }}
                >
                  <Plus size={11} /> 去创建 Agent
                </Link>
              </div>
            )}

            {/* Agent 列表 */}
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => { onChange(agent); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  width: "100%", textAlign: "left",
                  padding: "8px 10px", borderRadius: "7px", border: "none",
                  backgroundColor: agent.id === value ? "var(--sidebar-active)" : "transparent",
                  color: agent.id === value ? "var(--accent-blue)" : "var(--text-primary)",
                  fontSize: "13px", cursor: "pointer", outline: "none",
                  transition: "background-color 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (agent.id !== value) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-hover)";
                }}
                onMouseLeave={(e) => {
                  if (agent.id !== value) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              >
                {/* Agent 图标 */}
                <span style={{
                  width: "28px", height: "28px", borderRadius: "7px",
                  backgroundColor: agent.iconColor,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "rgba(255,255,255,0.9)", flexShrink: 0,
                }}>
                  {AGENT_ICON_MAP[agent.iconName] ?? <Sparkles size={14} />}
                </span>
                {/* Agent 信息 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent.name}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent.model} · Lv.{agent.level}
                  </div>
                </div>
              </button>
            ))}
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

// ── 上下文占用进度条 ──
function ContextBar({
  totalInputTokens,
  contextLimit,
  ctxUsagePercent,
  onManualCompress,
  isCompressing,
}: {
  totalInputTokens: number;
  contextLimit: number;
  ctxUsagePercent: number;
  onManualCompress?: () => void;
  isCompressing?: boolean;
}) {
  // 只有有实际数据时才显示（至少发过一条消息）
  if (totalInputTokens === 0) return null;

  const color =
    ctxUsagePercent >= 90 ? "#ef4444" :
    ctxUsagePercent >= 70 ? "#f59e0b" :
    "#22c55e";

  const bgColor =
    ctxUsagePercent >= 90 ? "rgba(239,68,68,0.12)" :
    ctxUsagePercent >= 70 ? "rgba(245,158,11,0.12)" :
    "rgba(34,197,94,0.12)";

  const formatK = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "4px 16px",
        backgroundColor: bgColor,
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
        transition: "background-color 0.3s",
      }}
    >
      {/* 进度条 */}
      <div
        style={{
          flex: 1, height: "3px", borderRadius: "2px",
          backgroundColor: "var(--border-color)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, ctxUsagePercent)}%`,
            backgroundColor: color,
            borderRadius: "2px",
            transition: "width 0.4s ease, background-color 0.3s",
          }}
        />
      </div>

      {/* 文字标注 */}
      <span style={{ fontSize: "11px", color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
        {ctxUsagePercent}% · {formatK(totalInputTokens)} / {formatK(contextLimit)} tokens
      </span>

      {/* 手动压缩按钮 */}
      <button
        title={isCompressing ? "正在压缩..." : "智能压缩上下文"}
        onClick={onManualCompress}
        disabled={isCompressing}
        style={{
          display: "flex", alignItems: "center", gap: "4px",
          padding: "2px 7px", borderRadius: "5px",
          border: `1px solid ${color}`,
          backgroundColor: "transparent",
          color,
          fontSize: "11px", cursor: isCompressing ? "not-allowed" : "pointer",
          outline: "none", flexShrink: 0,
          opacity: isCompressing ? 0.6 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {isCompressing
          ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} />
          : <Scissors size={10} />
        }
        {isCompressing ? "压缩中..." : "压缩"}
      </button>
    </div>
  );
}

// ── 主组件 ──
export function ChatToolbar({
  conversationId,
  conversations,
  onConversationChange,
  agentId,
  onAgentChange,
  streaming = false,
  onAbort,
  onNewConversation,
  totalInputTokens = 0,
  contextLimit = 128000,
  ctxUsagePercent = 0,
  onManualCompress,
  isCompressing = false,
}: {
  conversationId: string | null;
  conversations: ConversationRow[];
  onConversationChange: (id: string | null) => void;
  agentId: string;
  onAgentChange: (agent: AgentRow | null) => void;
  streaming?: boolean;
  onAbort?: () => void;
  onNewConversation?: () => void;
  totalInputTokens?: number;
  contextLimit?: number;
  ctxUsagePercent?: number;
  onManualCompress?: () => void;
  isCompressing?: boolean;
}) {
  return (
    <div style={{ flexShrink: 0 }}>
      {/* 主工具栏行 */}
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: ctxUsagePercent > 0 ? "none" : "1px solid var(--border-subtle)",
          backgroundColor: "var(--topbar-bg)",
          gap: "8px",
        }}
      >
        {/* 左侧：新对话按钮 + 会话选择器 + Agent 选择 */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ToolBtn title="新对话" onClick={onNewConversation}>
            <SquarePen size={15} />
          </ToolBtn>
          <ConversationSelector
            currentId={conversationId}
            conversations={conversations}
            onChange={onConversationChange}
          />
          <AgentSelector
            value={agentId}
            onChange={onAgentChange}
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
          <ToolBtn title="下载对话">
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

      {/* 上下文占用进度条（有数据时显示在工具栏下方） */}
      <ContextBar
        totalInputTokens={totalInputTokens}
        contextLimit={contextLimit}
        ctxUsagePercent={ctxUsagePercent}
        onManualCompress={onManualCompress}
        isCompressing={isCompressing}
      />
    </div>
  );
}
