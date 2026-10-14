"use client";

import {
  BrainCircuit, Users, GitBranch, Zap,
  ChevronRight, ChevronLeft, Plus, ChevronDown, ChevronUp,
  Crown, X, MessageSquare, Check,
  Sparkles, Loader2, AlertCircle, FileText, Save, Trophy, Download,
  History, Clock, Trash2, RefreshCw,
} from "lucide-react";
import {
  useState, useEffect, useCallback, useRef, useMemo, forwardRef,
} from "react";
import { useRouter } from "next/navigation";
import { agentRepo } from "@/lib/repositories/agent-repository";
import { apiKeyRepo } from "@/lib/repositories/api-key-repository";
import type { AgentRow } from "@/lib/db/idb";
import type { ApiKeyRecord } from "@/lib/repositories/api-key-repository";

// ─────────────────────────────────────────────
// 推演存档数据结构
// ─────────────────────────────────────────────
interface SessionRecord {
  id: string;                    // 唯一 ID（时间戳）
  topic: string;                 // 推演议题
  agentNames: string[];          // 参与 Agent 名称列表（用于展示）
  agentCount: number;            // Agent 数量
  doneCount: number;             // 成功完成数量
  messages: DeductionMessage[];  // 完整推演结果
  createdAt: number;             // 创建时间戳（ms）
}

const SESSION_STORAGE_KEY = "cor_think_tank_sessions";
const MAX_SESSIONS = 20;         // 最多保留 20 条存档

function loadSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionRecord[]) : [];
  } catch {
    return [];
  }
}

function saveSession(record: SessionRecord): void {
  try {
    const existing = loadSessions();
    // 去重（同 id 覆盖），新的放最前面
    const filtered = existing.filter((s) => s.id !== record.id);
    const next = [record, ...filtered].slice(0, MAX_SESSIONS);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 写入失败（隐私模式等），静默忽略
  }
}

function deleteSession(id: string): void {
  try {
    const existing = loadSessions();
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(existing.filter((s) => s.id !== id)));
  } catch { /* 静默 */ }
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min  = Math.floor(diff / 60_000);
  const hour = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (min < 1)   return "刚刚";
  if (min < 60)  return `${min} 分钟前`;
  if (hour < 24) return `${hour} 小时前`;
  if (day < 7)   return `${day} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────
// 组织阶段类型定义
// ─────────────────────────────────────────────
interface OrganizeRole {
  agent_id: string;
  role: string;
  task_prompt: string;
  reports_to: string | null;
}

interface OrganizeEdge {
  from: string;
  to: string;
  label: string;
}

interface OrganizeResult {
  roles: OrganizeRole[];
  edges: OrganizeEdge[];
}

// Prompt 模版
interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
}

// ─────────────────────────────────────────────
// 历史存档侧边栏
// ─────────────────────────────────────────────
function SessionListPanel({
  onClose,
  onLoad,
}: {
  onClose: () => void;
  onLoad: (record: SessionRecord) => void;
}) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [hoverId, setHoverId]   = useState<string | null>(null);

  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          backgroundColor: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* 侧边栏主体 */}
      <div
        style={{
          position: "fixed", top: 0, left: 0, bottom: 0,
          width: "360px", zIndex: 50,
          backgroundColor: "rgba(10,14,26,0.98)",
          borderRight: "1px solid var(--border-subtle)",
          display: "flex", flexDirection: "column",
          backdropFilter: "blur(20px)",
          boxShadow: "4px 0 32px rgba(0,0,0,0.5)",
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex", alignItems: "center", gap: "10px",
            flexShrink: 0,
          }}
        >
          <History size={16} style={{ color: "var(--accent-blue)" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              推演存档
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "1px" }}>
              {sessions.length > 0 ? `共 ${sessions.length} 条记录` : "暂无存档"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 列表 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
          {sessions.length === 0 ? (
            <div
              style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: "200px", gap: "12px", opacity: 0.4,
              }}
            >
              <History size={36} style={{ color: "var(--text-muted)" }} />
              <p style={{ fontSize: "13px", color: "var(--text-muted)", textAlign: "center", margin: 0 }}>
                完成一次推演后<br />结果会自动保存到这里
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => onLoad(s)}
                  onMouseEnter={() => setHoverId(s.id)}
                  onMouseLeave={() => setHoverId(null)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: hoverId === s.id ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.02)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    position: "relative",
                  }}
                >
                  {/* 议题 */}
                  <div
                    style={{
                      fontSize: "13px", fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      marginBottom: "6px",
                      paddingRight: "28px",
                    }}
                  >
                    {s.topic}
                  </div>

                  {/* 元信息行 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    {/* Agent 数量 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Users size={10} style={{ color: "var(--text-muted)" }} />
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {s.agentCount} 位 Agent
                      </span>
                    </div>
                    {/* 完成数 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Check size={10} style={{ color: "#22c55e" }} />
                      <span style={{ fontSize: "10px", color: "#22c55e" }}>
                        {s.doneCount} 完成
                      </span>
                    </div>
                    {/* 时间 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "auto" }}>
                      <Clock size={10} style={{ color: "var(--text-muted)" }} />
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                        {formatRelativeTime(s.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Agent 名称标签 */}
                  <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
                    {s.agentNames.slice(0, 4).map((name) => (
                      <span
                        key={name}
                        style={{
                          fontSize: "9px", padding: "1px 6px", borderRadius: "8px",
                          backgroundColor: "rgba(59,130,246,0.1)",
                          border: "1px solid rgba(59,130,246,0.2)",
                          color: "var(--accent-blue)",
                        }}
                      >
                        {name}
                      </span>
                    ))}
                    {s.agentNames.length > 4 && (
                      <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                        +{s.agentNames.length - 4}
                      </span>
                    )}
                  </div>

                  {/* 删除按钮（hover 时显示） */}
                  {hoverId === s.id && (
                    <button
                      onClick={(e) => handleDelete(e, s.id)}
                      title="删除此存档"
                      style={{
                        position: "absolute", top: "10px", right: "10px",
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--text-muted)", padding: "3px",
                        borderRadius: "4px",
                        transition: "color 0.15s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: "10px", color: "var(--text-muted)", margin: 0, textAlign: "center", opacity: 0.6 }}>
            存档保存在本地浏览器，最多保留 {MAX_SESSIONS} 条
          </p>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 步骤定义
// ─────────────────────────────────────────────
const STEPS = [
  { id: 0, icon: Users,     label: "组建团队" },
  { id: 1, icon: GitBranch, label: "提出议题" },
  { id: 2, icon: Zap,       label: "并行推演" },
  { id: 3, icon: Trophy,    label: "结果产出" },
];

// ─────────────────────────────────────────────
// 顶部标题行（含进度条）
// ─────────────────────────────────────────────
function TopBar({
  current,
  onOpenHistory,
  sessionCount,
}: {
  current: number;
  onOpenHistory: () => void;
  sessionCount: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "0 20px",
        height: "52px",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
      }}
    >
      {/* 品牌标识 */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        <BrainCircuit size={16} style={{ color: "var(--accent-blue)" }} />
        <div>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
            Agent-Nest
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>
            多 Agent 协作推演
          </span>
        </div>
      </div>

      {/* 历史存档按钮 */}
      <button
        onClick={onOpenHistory}
        title="查看历史推演存档"
        style={{
          display: "flex", alignItems: "center", gap: "5px",
          padding: "5px 10px", borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          backgroundColor: "transparent",
          color: "var(--text-muted)",
          fontSize: "11px", cursor: "pointer",
          flexShrink: 0,
          transition: "all 0.15s ease",
          position: "relative",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(59,130,246,0.08)";
          e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)";
          e.currentTarget.style.color = "var(--accent-blue)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.borderColor = "var(--border-subtle)";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <History size={12} />
        存档
        {sessionCount > 0 && (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "16px", height: "16px", borderRadius: "50%",
            backgroundColor: "var(--accent-blue)", color: "#fff",
            fontSize: "9px", fontWeight: 700,
          }}>
            {sessionCount > 9 ? "9+" : sessionCount}
          </span>
        )}
      </button>

      {/* 分隔线 */}
      <div style={{ width: "1px", height: "20px", backgroundColor: "var(--border-subtle)", flexShrink: 0 }} />

      {/* 进度条（占满剩余宽度） */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "0", minWidth: 0 }}>
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === current;
          const isDone   = idx < current;
          const isFuture = idx > current;

          return (
            <div
              key={step.id}
              style={{
                display: "flex",
                alignItems: "center",
                flex: idx < STEPS.length - 1 ? 1 : "none",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 8px 4px 4px",
                  borderRadius: "16px",
                  backgroundColor: isActive
                    ? "rgba(59,130,246,0.12)"
                    : isDone
                    ? "rgba(34,197,94,0.08)"
                    : "transparent",
                  border: isActive
                    ? "1px solid rgba(59,130,246,0.3)"
                    : isDone
                    ? "1px solid rgba(34,197,94,0.2)"
                    : "1px solid transparent",
                  transition: "all 0.25s ease",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isActive
                      ? "var(--accent-blue)"
                      : isDone
                      ? "#22c55e"
                      : "var(--bg-secondary)",
                    border: isFuture ? "1px solid var(--border-subtle)" : "none",
                    flexShrink: 0,
                    transition: "all 0.25s ease",
                  }}
                >
                  <Icon size={9} style={{ color: isActive || isDone ? "#fff" : "var(--text-muted)" }} />
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive
                      ? "var(--accent-blue)"
                      : isDone
                      ? "#22c55e"
                      : "var(--text-muted)",
                    whiteSpace: "nowrap",
                    transition: "all 0.25s ease",
                  }}
                >
                  {step.label}
                </span>
              </div>

              {idx < STEPS.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: "1px",
                    margin: "0 4px",
                    backgroundColor: isDone ? "rgba(34,197,94,0.3)" : "var(--border-subtle)",
                    transition: "background-color 0.3s ease",
                    minWidth: "12px",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Agent 图标
// ─────────────────────────────────────────────
function AgentIcon({
  iconName, iconColor, size = 32,
}: { iconName: string; iconColor: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        backgroundColor: iconColor + "22",
        border: `1px solid ${iconColor}44`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        color: iconColor,
        fontWeight: 700,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {iconName.slice(0, 1).toUpperCase()}
    </div>
  );
}

// ─────────────────────────────────────────────
// 第 1 页：组建团队
// ─────────────────────────────────────────────
function StepTeam({
  agents, selected, organizerId, onToggle, onSetOrganizer, loading, onNext,
}: {
  agents: AgentRow[];
  selected: Set<string>;
  organizerId: string | null;
  onToggle: (id: string) => void;
  onSetOrganizer: (id: string | null) => void;
  loading: boolean;
  onNext: () => void;
}) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "16px 24px 10px", flexShrink: 0 }}>
        <h2 style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
          选择参与推演的 Agent
        </h2>
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "3px 0 0" }}>
          已选 {selected.size} 个 · 可指定一个「组织者」Agent 自动编排工作流
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "120px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>加载中…</span>
          </div>
        ) : agents.length === 0 ? (
          <div
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "12px", padding: "40px 20px",
              borderRadius: "12px", border: "1px dashed var(--border-subtle)",
              backgroundColor: "var(--bg-secondary)", textAlign: "center",
            }}
          >
            <BrainCircuit size={32} style={{ color: "var(--text-muted)" }} />
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", margin: 0 }}>
                还没有 Agent
              </p>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "6px 0 0" }}>
                先去 Agent 养成页面创建你的第一个 Agent
              </p>
            </div>
            <button
              onClick={() => router.push("/health/agent")}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 16px", borderRadius: "8px", border: "none",
                backgroundColor: "var(--accent-blue)", color: "#fff",
                fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}
            >
              <Plus size={14} />去创建 Agent
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "10px", paddingBottom: "16px",
            }}
          >
            {agents.map((agent) => {
              const isSelected  = selected.has(agent.id);
              const isOrganizer = organizerId === agent.id;

              return (
                <div
                  key={agent.id}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: "12px",
                    padding: "12px", borderRadius: "10px",
                    border: `1px solid ${isSelected ? agent.iconColor + "55" : "var(--border-subtle)"}`,
                    backgroundColor: isSelected ? agent.iconColor + "0e" : "var(--bg-secondary)",
                    transition: "all 0.15s ease", position: "relative",
                  }}
                >
                  {/* 组织者皇冠 */}
                  {isOrganizer && (
                    <div
                      style={{
                        position: "absolute", top: "-8px", left: "50%",
                        transform: "translateX(-50%)",
                        backgroundColor: "#f59e0b",
                        borderRadius: "10px", padding: "2px 8px",
                        display: "flex", alignItems: "center", gap: "3px",
                        fontSize: "10px", fontWeight: 700, color: "#fff",
                        boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <Crown size={9} />组织者
                    </div>
                  )}

                  <button
                    onClick={() => onToggle(agent.id)}
                    style={{
                      display: "contents", cursor: "pointer",
                      background: "none", border: "none", padding: 0,
                    }}
                  >
                    <AgentIcon iconName={agent.iconName} iconColor={agent.iconColor} size={36} />
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
                      <button
                        onClick={() => onToggle(agent.id)}
                        style={{
                          fontSize: "13px", fontWeight: 600,
                          color: isSelected ? agent.iconColor : "var(--text-primary)",
                          background: "none", border: "none", padding: 0,
                          cursor: "pointer", textAlign: "left",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {agent.name}
                      </button>
                      {isSelected && (
                        <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: agent.iconColor, flexShrink: 0 }} />
                      )}
                    </div>
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {agent.role}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px" }}>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)", borderRadius: "4px", padding: "1px 5px" }}>
                        Lv.{agent.level}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {agent.model}
                      </span>
                    </div>
                    {/* 设为/取消组织者 */}
                    {isSelected && (
                      <button
                        onClick={() => onSetOrganizer(isOrganizer ? null : agent.id)}
                        style={{
                          marginTop: "6px", fontSize: "10px", fontWeight: 500,
                          color: isOrganizer ? "#f59e0b" : "var(--text-muted)",
                          background: "none", border: `1px solid ${isOrganizer ? "#f59e0b44" : "var(--border-subtle)"}`,
                          borderRadius: "4px", padding: "2px 7px", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: "3px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Crown size={9} />
                        {isOrganizer ? "取消组织者" : "设为组织者"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
        <button
          disabled={selected.size === 0}
          onClick={onNext}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 18px", borderRadius: "8px", border: "none",
            backgroundColor: selected.size === 0 ? "var(--bg-secondary)" : "var(--accent-blue)",
            color: selected.size === 0 ? "var(--text-muted)" : "#fff",
            fontSize: "13px", fontWeight: 600,
            cursor: selected.size === 0 ? "not-allowed" : "pointer",
            transition: "all 0.15s ease",
          }}
        >
          下一步<ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 第 2 页：提出议题
// ─────────────────────────────────────────────
function StepTopic({
  topic, onTopicChange, selectedAgents, agents, organizerId, onPrev, onNext,
}: {
  topic: string;
  onTopicChange: (v: string) => void;
  selectedAgents: Set<string>;
  agents: AgentRow[];
  organizerId: string | null;
  onPrev: () => void;
  onNext: () => void;
}) {
  const selected = agents.filter((a) => selectedAgents.has(a.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
        {/* 已选 Agent 预览 */}
        <div style={{ marginBottom: "18px" }}>
          <h2 style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            参与推演（{selected.length} 个）
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {selected.map((agent) => (
              <div
                key={agent.id}
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "4px 8px 4px 5px", borderRadius: "16px",
                  backgroundColor: agent.iconColor + "12",
                  border: `1px solid ${agent.iconColor}40`,
                }}
              >
                {organizerId === agent.id && <Crown size={9} style={{ color: "#f59e0b" }} />}
                <AgentIcon iconName={agent.iconName} iconColor={agent.iconColor} size={18} />
                <span style={{ fontSize: "11px", fontWeight: 500, color: agent.iconColor }}>
                  {agent.name}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 议题输入 */}
        <div>
          <h2 style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            推演议题
          </h2>
          <textarea
            value={topic}
            onChange={(e) => onTopicChange(e.target.value)}
            placeholder={"描述你想让智囊团推演的问题、决策或方案…\n\n例如：我们是否应该将现有的单体架构拆分为微服务？"}
            rows={6}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: "10px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)",
              fontSize: "13px", lineHeight: 1.6, resize: "vertical",
              outline: "none", fontFamily: "inherit", boxSizing: "border-box",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-blue)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          />
          <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "5px 0 0" }}>
            {topic.length} 字
          </p>
        </div>
      </div>

      <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <button onClick={onPrev} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border-subtle)", backgroundColor: "transparent", color: "var(--text-secondary)", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>
          <ChevronLeft size={14} />上一步
        </button>
        <button
          disabled={!topic.trim()}
          onClick={onNext}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 18px", borderRadius: "8px", border: "none",
            backgroundColor: !topic.trim() ? "var(--bg-secondary)" : "var(--accent-blue)",
            color: !topic.trim() ? "var(--text-muted)" : "#fff",
            fontSize: "13px", fontWeight: 600,
            cursor: !topic.trim() ? "not-allowed" : "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <Zap size={13} />启动推演<ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 星图节点数据
// ─────────────────────────────────────────────
interface NodeData {
  id: string;
  agent: AgentRow;
  x: number;
  y: number;
  isOrganizer: boolean;
  status: "idle" | "waiting" | "working" | "done" | "error";
  // 组织阶段分配的信息
  role?: string;
  taskPrompt?: string;
  reportsTo?: string | null;
}

// ─────────────────────────────────────────────
// 粒子动画（Canvas 层）
// ─────────────────────────────────────────────
interface Particle {
  id: string;          // 唯一 id，用于追踪拖尾
  fromId: string;
  toId: string;
  progress: number;    // 0~1，沿连线的位置
  speed: number;       // 每帧推进量
  color: string;       // 粒子颜色（来自 fromAgent）
  size: number;        // 核心半径（1.5~4，token 速率越快越大）
  tail: Array<{ x: number; y: number; alpha: number }>; // 拖尾历史坐标
}

// MeshCanvas 接收 particlesRef（外部 ref），在 rAF 里自己推进粒子并绘制
// 完全不触发 React re-render，彻底避免卡死
function MeshCanvas({
  nodes,
  canvasSize,
  particlesRef,
  edges,
}: {
  nodes: NodeData[];
  canvasSize: { w: number; h: number };
  particlesRef: React.MutableRefObject<Particle[]>;
  edges?: OrganizeEdge[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);

  const nodeMap = useMemo(() => {
    const m: Record<string, NodeData> = {};
    nodes.forEach((n) => { m[n.id] = n; });
    return m;
  }, [nodes]);

  // 所有动态数据都用 ref 持有，rAF 闭包里直接读，不依赖 React 渲染周期
  const nodeMapRef    = useRef(nodeMap);
  useEffect(() => { nodeMapRef.current = nodeMap; }, [nodeMap]);
  const nodesRef      = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const edgesRef      = useRef(edges);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const canvasSizeRef = useRef(canvasSize);
  useEffect(() => { canvasSizeRef.current = canvasSize; }, [canvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 绘制箭头辅助函数
    const drawArrow = (
      fromX: number, fromY: number,
      toX: number,   toY: number,
      color: string,
      nodeRadius: number,
    ) => {
      const dx = toX - fromX, dy = toY - fromY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return;
      const ux = dx / dist, uy = dy / dist;
      const sx = fromX + ux * nodeRadius,       sy = fromY + uy * nodeRadius;
      const ex = toX   - ux * (nodeRadius + 10), ey = toY   - uy * (nodeRadius + 10);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      const arrowLen = 8, arrowAngle = Math.PI / 6;
      const angle = Math.atan2(ey - sy, ex - sx);
      ctx.beginPath(); ctx.moveTo(ex, ey);
      ctx.lineTo(ex - arrowLen * Math.cos(angle - arrowAngle), ey - arrowLen * Math.sin(angle - arrowAngle));
      ctx.lineTo(ex - arrowLen * Math.cos(angle + arrowAngle), ey - arrowLen * Math.sin(angle + arrowAngle));
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    };

    const draw = () => {
      const { w, h } = canvasSizeRef.current;
      const nm = nodeMapRef.current;
      const ns = nodesRef.current;
      const es = edgesRef.current;
      // 直接读外部 ref，不经过 React state
      const ps = particlesRef.current;

      ctx.clearRect(0, 0, w, h);

      // ── 连线 ──
      if (es && es.length > 0) {
        es.forEach((edge) => {
          const a = nm[edge.from], b = nm[edge.to];
          if (!a || !b) return;
          const nodeRadius = a.isOrganizer ? 36 : 28;
          const lg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          lg.addColorStop(0, a.agent.iconColor + "99");
          lg.addColorStop(1, b.agent.iconColor + "99");
          drawArrow(a.x, a.y, b.x, b.y, lg as unknown as string, nodeRadius);
        });
      } else {
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            const lg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            lg.addColorStop(0, a.agent.iconColor + "55");
            lg.addColorStop(1, b.agent.iconColor + "55");
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = lg; ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }

      // ── 粒子推进 + 绘制（彗星效果，全在 rAF 里，零 re-render）──
      const survived: Particle[] = [];
      for (const p of ps) {
        const from = nm[p.fromId], to = nm[p.toId];
        if (!from || !to) continue;

        // 推进 progress，记录拖尾（存 progress 快照）
        const newProgress = p.progress + p.speed;
        if (newProgress >= 1) continue; // 到达终点，丢弃
        const tailEntry = { x: p.progress, y: 0, alpha: 1 };
        p.progress = newProgress;
        p.tail = [...p.tail.slice(-10), tailEntry];
        survived.push(p);

        const cx = from.x + (to.x - from.x) * p.progress;
        const cy = from.y + (to.y - from.y) * p.progress;

        // 1. 拖尾线段
        if (p.tail.length > 1) {
          for (let i = 0; i < p.tail.length - 1; i++) {
            const prog0 = p.tail[i].x, prog1 = p.tail[i + 1].x;
            const tx0 = from.x + (to.x - from.x) * prog0;
            const ty0 = from.y + (to.y - from.y) * prog0;
            const tx1 = from.x + (to.x - from.x) * prog1;
            const ty1 = from.y + (to.y - from.y) * prog1;
            const ratio = i / p.tail.length;
            const alpha = Math.round(ratio * 0.55 * 255).toString(16).padStart(2, "0");
            ctx.beginPath(); ctx.moveTo(tx0, ty0); ctx.lineTo(tx1, ty1);
            ctx.strokeStyle = p.color + alpha;
            ctx.lineWidth = Math.max(0.3, ratio * p.size * 1.1);
            ctx.lineCap = "round"; ctx.stroke();
          }
        }

        // 2. 外发光晕
        const glowR = p.size * 3.5;
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        glow.addColorStop(0,   p.color + "66");
        glow.addColorStop(0.5, p.color + "22");
        glow.addColorStop(1,   p.color + "00");
        ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow; ctx.fill();

        // 3. 亮核心
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.size);
        core.addColorStop(0,   "#ffffff");
        core.addColorStop(0.4, p.color + "ee");
        core.addColorStop(1,   p.color + "44");
        ctx.beginPath(); ctx.arc(cx, cy, p.size, 0, Math.PI * 2);
        ctx.fillStyle = core; ctx.fill();
      }
      // 原地替换，保持同一个数组对象（外部 ref 指向不变）
      particlesRef.current.length = 0;
      for (const p of survived) particlesRef.current.push(p);

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  // 只在挂载时启动一次 rAF 循环
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.w}
      height={canvasSize.h}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}

// ─────────────────────────────────────────────
// 星图节点组件
// ─────────────────────────────────────────────
const STATUS_COLORS: Record<NodeData["status"], string> = {
  idle:    "#6b7280",
  waiting: "#f59e0b",
  working: "#3b82f6",
  done:    "#22c55e",
  error:   "#ef4444",
};

function MeshNode({
  node,
  onDragStart,
  onClick,
}: {
  node: NodeData;
  onDragStart: (e: React.MouseEvent, id: string) => void;
  onClick: (id: string) => void;
}) {
  const R = node.isOrganizer ? 36 : 28;
  const color = node.agent.iconColor;
  const statusColor = STATUS_COLORS[node.status];

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault(); // 阻止文字选中，不影响 mousemove
        onDragStart(e, node.id);
      }}
      onClick={() => onClick(node.id)}
      style={{
        position: "absolute",
        left: node.x - R,
        top:  node.y - R,
        width:  R * 2,
        height: R * 2,
        cursor: "grab",
        userSelect: "none",
      }}
    >
      {/* 组织者外光环 */}
      {node.isOrganizer && (
        <div
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: "50%",
            border: "2px solid rgba(245,158,11,0.9)",
            boxShadow: "0 0 20px rgba(245,158,11,0.6), 0 0 40px rgba(245,158,11,0.25)",
            animation: "pulse-ring 2s ease-in-out infinite",
          }}
        />
      )}

      {/* 节点主体 */}
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          backgroundColor: color + "55",
          border: `2.5px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: R * 0.5,
          fontWeight: 700,
          color: "#fff",
          textShadow: "0 1px 3px rgba(0,0,0,0.7)",
          boxShadow: node.status === "working"
            ? `0 0 24px ${color}cc, 0 0 48px ${color}66, inset 0 0 12px ${color}44`
            : node.status === "waiting"
            ? `0 0 14px rgba(245,158,11,0.4), 0 2px 8px rgba(0,0,0,0.5)`
            : `0 0 14px ${color}88, 0 2px 8px rgba(0,0,0,0.5)`,
          transition: "box-shadow 0.3s ease",
          position: "relative",
        }}
      >
        {node.agent.iconName.slice(0, 1).toUpperCase()}

        {/* 状态指示点 */}
        <div
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: statusColor,
            border: "1.5px solid var(--bg-primary)",
            boxShadow: (node.status === "working" || node.status === "waiting") ? `0 0 6px ${statusColor}` : "none",
            animation: (node.status === "working" || node.status === "waiting") ? "blink 1.2s ease-in-out infinite" : "none",
          }}
        />

        {/* 组织者皇冠 */}
        {node.isOrganizer && (
          <div
            style={{
              position: "absolute",
              top: -14,
              left: "50%",
              transform: "translateX(-50%)",
              color: "#f59e0b",
              filter: "drop-shadow(0 1px 3px rgba(245,158,11,0.6))",
            }}
          >
            <Crown size={12} />
          </div>
        )}
      </div>

      {/* 节点名称 */}
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: "6px",
          whiteSpace: "nowrap",
          fontSize: "11px",
          fontWeight: 600,
          color: "#e2e8f0",
          textShadow: "0 1px 4px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.8)",
          pointerEvents: "none",
        }}
      >
        {node.agent.name}
      </div>

      {/* 职位标签（组织完成后显示） */}
      {node.role && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginTop: "22px",
            whiteSpace: "nowrap",
            fontSize: "9px",
            fontWeight: 500,
            color: node.agent.iconColor,
            backgroundColor: node.agent.iconColor + "1a",
            border: `1px solid ${node.agent.iconColor}44`,
            borderRadius: "8px",
            padding: "1px 6px",
            pointerEvents: "none",
            backdropFilter: "blur(4px)",
          }}
        >
          {node.role}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 节点详情弹窗（点击节点触发）
// ─────────────────────────────────────────────
function NodeDetailPanel({
  node,
  nodes,
  onClose,
  onSave,
}: {
  node: NodeData;
  nodes: NodeData[];
  onClose: () => void;
  onSave: (id: string, role: string, taskPrompt: string) => void;
}) {
  const [editRole, setEditRole]         = useState(node.role ?? "");
  const [editPrompt, setEditPrompt]     = useState(node.taskPrompt ?? "");
  const [saved, setSaved]               = useState(false);

  // 上级 Agent 名称
  const reportsToNode = node.reportsTo
    ? nodes.find((n) => n.id === node.reportsTo)
    : null;

  const handleSave = () => {
    onSave(node.id, editRole, editPrompt);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: "320px",
        backgroundColor: "rgba(10,14,26,0.97)",
        borderLeft: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        backdropFilter: "blur(16px)",
        zIndex: 20,
      }}
    >
      {/* 面板头 */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexShrink: 0,
        }}
      >
        {/* Agent 头像 */}
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            backgroundColor: node.agent.iconColor + "33",
            border: `2px solid ${node.agent.iconColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "15px",
            fontWeight: 700,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {node.agent.iconName.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.agent.name}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "1px" }}>
            {node.agent.model}
            {node.isOrganizer && (
              <span style={{ marginLeft: "6px", color: "#f59e0b", fontWeight: 600 }}>· 组织者</span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px", flexShrink: 0 }}
        >
          <X size={15} />
        </button>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* 上级 Agent */}
        {reportsToNode && (
          <div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              汇报对象
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "7px 10px",
                borderRadius: "8px",
                backgroundColor: reportsToNode.agent.iconColor + "12",
                border: `1px solid ${reportsToNode.agent.iconColor}30`,
              }}
            >
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  backgroundColor: reportsToNode.agent.iconColor + "33",
                  border: `1.5px solid ${reportsToNode.agent.iconColor}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "9px",
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {reportsToNode.agent.iconName.slice(0, 1).toUpperCase()}
              </div>
              <span style={{ fontSize: "12px", color: reportsToNode.agent.iconColor, fontWeight: 600 }}>
                {reportsToNode.agent.name}
              </span>
              {reportsToNode.role && (
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                  · {reportsToNode.role}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 职位 */}
        <div>
          <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "6px" }}>
            职位 / 角色
          </label>
          <input
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
            placeholder="例：前端架构师、数据分析师..."
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "rgba(255,255,255,0.04)",
              color: "var(--text-primary)",
              fontSize: "12px",
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = node.agent.iconColor + "88"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          />
        </div>

        {/* 任务 Prompt */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "6px" }}>
            任务 Prompt
          </label>
          <textarea
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="描述该 Agent 在本次推演中的具体任务..."
            rows={8}
            style={{
              flex: 1,
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "rgba(255,255,255,0.04)",
              color: "var(--text-primary)",
              fontSize: "12px",
              lineHeight: 1.6,
              outline: "none",
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "inherit",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = node.agent.iconColor + "88"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
          />
        </div>
      </div>

      {/* 底部保存按钮 */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <button
          onClick={handleSave}
          style={{
            width: "100%",
            padding: "9px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: saved ? "#22c55e" : node.agent.iconColor,
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            transition: "background-color 0.2s ease",
          }}
        >
          {saved ? <Check size={13} /> : <Save size={13} />}
          {saved ? "已保存" : "保存修改"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 底部 Agent Dock
// ─────────────────────────────────────────────
const AgentDock = forwardRef<HTMLDivElement, {
  agents: AgentRow[];
  placedIds: Set<string>;
  onAddToCanvas: (agentId: string) => void;
  onDragStart: (agentId: string) => void;
  onRemoveFromCanvas: (agentId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  isDragOver: boolean;
}>(function AgentDock({
  agents,
  placedIds,
  onAddToCanvas,
  onDragStart,
  collapsed,
  onToggleCollapse,
  isDragOver: dockDragOver,
}, ref) {
  const available = agents.filter((a) => !placedIds.has(a.id));
  const placed = agents.filter((a) => placedIds.has(a.id));

  return (
    <div
      ref={ref}
      style={{
        flexShrink: 0,
        borderTop: dockDragOver
          ? "1px solid rgba(239,68,68,0.6)"
          : "1px solid var(--border-subtle)",
        backgroundColor: dockDragOver
          ? "rgba(239,68,68,0.06)"
          : "rgba(10,14,26,0.85)",
        backdropFilter: "blur(8px)",
        transition: "background-color 0.15s ease, border-color 0.15s ease",
      }}
    >
      {/* Dock 标题栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 16px",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={onToggleCollapse}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Users size={12} style={{ color: dockDragOver ? "rgba(239,68,68,0.8)" : "var(--text-muted)" }} />
          <span style={{ fontSize: "11px", color: dockDragOver ? "rgba(239,68,68,0.9)" : "var(--text-muted)", fontWeight: 500 }}>
            {dockDragOver ? `松开移出星图` : `可用 Agent（${available.length}）`}
          </span>
          {!dockDragOver && available.length > 0 && (
            <span style={{ fontSize: "10px", color: "var(--text-muted)", opacity: 0.6 }}>
              · 点击或拖入星图 · 将星图节点拖回此处可移除
            </span>
          )}
          {!dockDragOver && available.length === 0 && placed.length > 0 && (
            <span style={{ fontSize: "10px", color: "var(--text-muted)", opacity: 0.6 }}>
              · 将星图节点拖回此处可移除
            </span>
          )}
        </div>
        {collapsed ? <ChevronUp size={13} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={13} style={{ color: "var(--text-muted)" }} />}
      </div>

      {/* 卡片列表 */}
      {!collapsed && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "0 16px 10px",
            overflowX: "auto",
            overflowY: "hidden",
            minHeight: "52px",
          }}
        >
          {available.length === 0 ? (
            <div style={{ fontSize: "11px", color: dockDragOver ? "rgba(239,68,68,0.7)" : "var(--text-muted)", padding: "8px 0", transition: "color 0.15s ease" }}>
              {dockDragOver ? "松开鼠标移出星图" : "所有 Agent 已在星图中"}
            </div>
          ) : (
            available.map((agent) => (
              <div
                key={agent.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("agentId", agent.id);
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStart(agent.id);
                }}
                onClick={() => onAddToCanvas(agent.id)}
                title={`点击或拖入星图：${agent.name}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "7px 12px 7px 8px",
                  borderRadius: "8px",
                  border: `1px solid ${agent.iconColor}33`,
                  backgroundColor: agent.iconColor + "0a",
                  cursor: "grab",
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                  userSelect: "none",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = agent.iconColor + "22";
                  (e.currentTarget as HTMLDivElement).style.borderColor = agent.iconColor + "77";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = agent.iconColor + "0a";
                  (e.currentTarget as HTMLDivElement).style.borderColor = agent.iconColor + "33";
                }}
              >
                <AgentIcon iconName={agent.iconName} iconColor={agent.iconColor} size={24} />
                <div style={{ textAlign: "left" }}>
                  <p style={{ fontSize: "11px", fontWeight: 600, color: agent.iconColor, margin: 0, whiteSpace: "nowrap" }}>
                    {agent.name}
                  </p>
                  <p style={{ fontSize: "10px", color: "var(--text-muted)", margin: 0, whiteSpace: "nowrap" }}>
                    {agent.model}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────
// 第 3 页：并行推演（星图）
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// DeductionMessage 接口（提升到顶层，供 StepResult 复用）
// ─────────────────────────────────────────────
interface DeductionMessage {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  agentIcon: string;
  text: string;
  status: "waiting" | "working" | "done" | "error";
  errorMsg?: string;
  timestamp: number;
  round: number;                // 所属推演轮次（1, 2, 3...）
  waitingFor?: string[];        // 等待的上游 Agent ID 列表（waiting 状态时）
}

// 推演完成回调携带的完整结果
interface DeductionResult {
  msgs: DeductionMessage[];
  mode: "graph" | "discussion";
  organizerSummary?: {
    agentId: string;
    agentName: string;
    agentColor: string;
    agentIcon: string;
    text: string;
  } | null;
}

function StepDeduction({
  selectedAgents,
  agents,
  organizerId,
  topic,
  onPrev,
  onRestart,
  onOrganizeDone,
  onDeductDone,
}: {
  selectedAgents: Set<string>;
  agents: AgentRow[];
  organizerId: string | null;
  topic: string;
  onPrev: () => void;
  onRestart: () => void;
  onOrganizeDone: () => void;
  onDeductDone: (result: DeductionResult) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dockRef      = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [nodes, setNodes]           = useState<NodeData[]>([]);
  const [placedIds, setPlacedIds]   = useState<Set<string>>(new Set());
  // 粒子完全用 ref 管理，不进 React state，避免每帧 re-render 卡死页面
  const particlesRef   = useRef<Particle[]>([]);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [isDragOver, setIsDragOver]   = useState(false);
  const [dockDragOver, setDockDragOver] = useState(false);
  const draggingRef    = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const particleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 记录每个 Agent 上一次的 text 长度，用于计算 token 增量
  const tokenCountRef = useRef<Record<string, number>>({});
  // 粒子 id 自增
  const particleIdRef = useRef(0);
  // 标记是否已完成首次初始化，避免 resize 重置节点
  const initializedRef = useRef(false);

  // ── 组织阶段状态 ──
  // "setup"：展示 Prompt 编辑区，等待用户点击「开始组织」
  // "organizing"：SSE 流式接收中
  // "done"：组织完成，星图已更新
  const [organizePhase, setOrganizePhase] = useState<"setup" | "organizing" | "done">("setup");
  const [organizerPrompt, setOrganizerPrompt] = useState("");
  const [templates, setTemplates]             = useState<PromptTemplate[]>([]);
  const [organizeThinking, setOrganizeThinking] = useState("");
  const [organizeError, setOrganizeError]       = useState("");
  const [edges, setEdges]                       = useState<OrganizeEdge[]>([]);
  // 节点详情弹窗
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  // API Key 列表（静默加载，自动匹配组织者模型，不暴露给用户选择）
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);

  // ── 推演阶段状态 ──
  const [deductPhase, setDeductPhase] = useState<"idle" | "running" | "done">("idle");
  const [deductMessages, setDeductMessages] = useState<DeductionMessage[]>([]);
  const [deductError, setDeductError]       = useState("");
  const [summary, setSummary]               = useState("");  // 综合结论（预留）
  const [currentRound, setCurrentRound]     = useState(1);  // 当前推演轮次
  // 推演模式：graph = 图结构并行推演，discussion = 研讨会多轮交流
  const [deductMode, setDeductMode] = useState<"graph" | "discussion">("discussion");
  // 研讨会模式：组织者总结消息（单独存储，UI 中特殊展示）
  const [organizerSummary, setOrganizerSummary] = useState<{ text: string; status: "working" | "done" } | null>(null);
  // 研讨会模式：组织者每轮裁判决策列表
  const [organizerDecisions, setOrganizerDecisions] = useState<Array<{
    round: number;
    continue: boolean;
    reason: string;
  }>>([]);
  const deductPanelRef = useRef<HTMLDivElement>(null);
  // 用 ref 暂存推演完成时的最终消息，避免在 setState updater 里调用父组件 setState
  const pendingDoneRef = useRef<DeductionResult | null>(null);
  // 记录每个 Agent 所属轮次（agent_id → round）
  const agentRoundRef = useRef<Record<string, number>>({});

  // 监听 deductPhase 变为 done，统一触发父组件回调（避免在渲染期间调用）
  useEffect(() => {
    if (deductPhase === "done" && pendingDoneRef.current !== null) {
      onDeductDone(pendingDoneRef.current);
      pendingDoneRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deductPhase]);

  // 监听画布尺寸（仅更新 canvasSize，不重置节点）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setCanvasSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // 首次初始化：已选 Agent 圆形分布放入星图（只执行一次）
  useEffect(() => {
    if (initializedRef.current) return;
    if (canvasSize.w === 0 || canvasSize.h === 0) return;

    const selected = agents.filter((a) => selectedAgents.has(a.id));
    if (selected.length === 0) {
      initializedRef.current = true;
      return;
    }

    const cx = canvasSize.w / 2;
    const cy = canvasSize.h / 2;
    const R  = Math.min(canvasSize.w, canvasSize.h) * 0.28;

    const initialNodes: NodeData[] = selected.map((agent, i) => {
      const angle = (2 * Math.PI * i) / selected.length - Math.PI / 2;
      return {
        id: agent.id,
        agent,
        x: cx + R * Math.cos(angle),
        y: cy + R * Math.sin(angle),
        isOrganizer: agent.id === organizerId,
        status: "idle",
      };
    });

    setNodes(initialNodes);
    setPlacedIds(new Set(selected.map((a) => a.id)));
    initializedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.w, canvasSize.h]);

  // 拉取 Prompt 模版
  useEffect(() => {
    fetch("http://localhost:8000/v1/organize/templates")
      .then((r) => r.json())
      .then((data: PromptTemplate[]) => setTemplates(data))
      .catch(() => {/* 静默失败，模版不是必须的 */});
  }, []);

  // 加载 API Key 列表（静默，不展示给用户）
  useEffect(() => {
    apiKeyRepo.getAll().then((keys) => setApiKeys(keys));
  }, []);

  // ── 实时 token 驱动粒子生成（直接写 ref，不触发 re-render）──
  // 仅在推演阶段（running）且有 working Agent 时才生成粒子
  useEffect(() => {
    if (nodes.length < 2 || deductPhase !== "running") return;

    const workingMsgs = deductMessages.filter((m) => m.status === "working" && m.text);
    if (workingMsgs.length === 0) return;

    workingMsgs.forEach((msg) => {
      const prevLen = tokenCountRef.current[msg.agentId] ?? 0;
      const delta   = msg.text.length - prevLen;
      tokenCountRef.current[msg.agentId] = msg.text.length;
      if (delta <= 0) return;

      // token 增量 → 粒子数量（每 10 字符 1 颗，最多 3 颗/次）
      const count = Math.min(3, Math.max(1, Math.floor(delta / 10)));
      // token 速率 → 粒子大小
      const size  = Math.min(3.5, 1.5 + delta / 40);

      const fromNode = nodes.find((n) => n.id === msg.agentId);
      if (!fromNode) return;

      for (let i = 0; i < count; i++) {
        let toNode: NodeData | undefined;
        if (deductMode === "discussion" && msg.round === 2) {
          toNode = nodes.find((n) => n.isOrganizer) ?? nodes.find((n) => n.id !== msg.agentId);
        } else if (deductMode === "discussion" && organizerSummary?.status === "working") {
          toNode = nodes.find((n) => n.isOrganizer);
        } else {
          const others = nodes.filter((n) => n.id !== msg.agentId);
          toNode = others[Math.floor(Math.random() * others.length)];
        }
        if (!toNode) return;

        // 直接 push 到 ref，Canvas rAF 循环会在下一帧读取
        const existing = particlesRef.current;
        if (existing.length >= 50) existing.splice(0, existing.length - 49);
        existing.push({
          id:       `p-${particleIdRef.current++}`,
          fromId:   fromNode.id,
          toId:     toNode.id,
          progress: 0,
          speed:    0.007 + Math.random() * 0.007,
          color:    fromNode.agent.iconColor,
          size,
          tail:     [],
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deductMessages, organizerSummary]);

  // 推演结束时清空粒子
  useEffect(() => {
    if (deductPhase === "idle" || deductPhase === "done") {
      particlesRef.current = [];
      tokenCountRef.current = {};
    }
  }, [deductPhase]);

  // 星图内拖拽逻辑：mousemove/mouseup 挂到 document，确保拖到 Dock 区域时不中断
  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault(); // 防止文字选中
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    draggingRef.current = {
      id,
      offsetX: e.clientX - rect.left - node.x,
      offsetY: e.clientY - rect.top  - node.y,
    };
  }, [nodes]);

  // document 级别的 mousemove/mouseup，挂载在 useEffect 中
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { id, offsetX, offsetY } = draggingRef.current;
      const x = e.clientX - rect.left - offsetX;
      const y = e.clientY - rect.top  - offsetY;
      setNodes((prev) => prev.map((n) => n.id === id ? { ...n, x, y } : n));

      // 检测是否悬停在 Dock 区域，给出高亮提示
      const dockRect = dockRef.current?.getBoundingClientRect();
      if (dockRect) {
        const over = e.clientX >= dockRect.left && e.clientX <= dockRect.right
                  && e.clientY >= dockRect.top  && e.clientY <= dockRect.bottom;
        setDockDragOver(over);
      }
    };

    const onUp = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const draggedId = draggingRef.current.id;
      draggingRef.current = null;
      setDockDragOver(false);

      // 检测松手位置是否在 Dock 区域内 → 移除节点
      const dockRect = dockRef.current?.getBoundingClientRect();
      if (dockRect) {
        const inDock = e.clientX >= dockRect.left && e.clientX <= dockRect.right
                    && e.clientY >= dockRect.top  && e.clientY <= dockRect.bottom;
        if (inDock) {
          setNodes((prev) => prev.filter((n) => n.id !== draggedId));
          setPlacedIds((prev) => {
            const next = new Set(prev);
            next.delete(draggedId);
            return next;
          });
        }
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [nodes]);

  // 点击节点：组织完成后打开详情弹窗
  const handleNodeClick = useCallback((id: string) => {
    if (draggingRef.current) return;
    if (organizePhase === "done") {
      setDetailNodeId((prev) => prev === id ? null : id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizePhase]);

  // 从星图移除节点（拖回 Dock）
  const handleRemoveNode = useCallback((agentId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== agentId));
    setPlacedIds((prev) => {
      const next = new Set(prev);
      next.delete(agentId);
      return next;
    });
  }, []);

  // 从 Dock 加入星图（点击 or drop）
  const handleAddFromDock = useCallback((agentId: string, dropX?: number, dropY?: number) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    const rect = containerRef.current?.getBoundingClientRect();
    let x: number, y: number;
    if (dropX !== undefined && dropY !== undefined && rect) {
      x = dropX - rect.left;
      y = dropY - rect.top;
    } else {
      x = canvasSize.w / 2 + (Math.random() - 0.5) * 200;
      y = canvasSize.h / 2 + (Math.random() - 0.5) * 150;
    }
    setNodes((prev) => [
      ...prev,
      { id: agentId, agent, x, y, isOrganizer: false, status: "idle" },
    ]);
    setPlacedIds((prev) => new Set([...prev, agentId]));
  }, [agents, canvasSize]);

  // 保存节点详情（职位 + 任务 Prompt）
  const handleSaveNodeDetail = useCallback((id: string, role: string, taskPrompt: string) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, role, taskPrompt } : n));
  }, []);

  // ── 开始推演：调用 /v1/graph-deduction SSE（方案 C：图结构消息传递）──
  const handleStartDeduction = useCallback(async () => {
    if (nodes.length === 0) return;
    setDeductPhase("running");
    setDeductError("");
    setSummary("");
    setCurrentRound(1);
    agentRoundRef.current = {};

    // 初始化每个 Agent 的消息条目（初始状态为 waiting，等待 round_start 事件更新）
    const initMsgs: DeductionMessage[] = nodes.map((n) => ({
      id: n.id,
      agentId: n.id,
      agentName: n.agent.name,
      agentColor: n.agent.iconColor,
      agentIcon: n.agent.iconName,
      text: "",
      status: "waiting",
      timestamp: Date.now(),
      round: 1,
    }));
    setDeductMessages(initMsgs);

    // 更新星图节点状态为 waiting
    setNodes((prev) => prev.map((n) => ({ ...n, status: "waiting" as const })));

    // 构造请求体（含 edges）
    const agentsPayload = nodes.map((n) => {
      const model = n.agent.model;
      const key =
        apiKeys.find((k) => k.modelName === model) ??
        apiKeys.find((k) => k.isActive) ??
        apiKeys[0];
      return {
        id: n.id,
        name: n.agent.name,
        model,
        system_prompt: n.agent.systemPrompt ?? "",
        role: n.role ?? "",
        task_prompt: n.taskPrompt ?? "",
        api_key: key?.keyValue ?? "",
        base_url: key?.baseUrl ?? null,
        extra_headers: key?.extraHeaders ?? null,
      };
    });

    // edges 数据（组织阶段生成的有向图）
    const edgesPayload = edges.map((e) => ({
      from: e.from,
      to: e.to,
      label: e.label,
    }));

    try {
      const resp = await fetch("http://localhost:8000/v1/graph-deduction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, agents: agentsPayload, edges: edgesPayload }),
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          try {
            const evt = JSON.parse(raw) as {
              type: string;
              agent_id?: string;
              agent_ids?: string[];
              content?: string;
              full_text?: string;
              message?: string;
              round?: number;
              waiting_for?: string[];
            };
            const aid = evt.agent_id;

            if (evt.type === "round_start" && evt.round && evt.agent_ids) {
              // 记录本轮 Agent 的轮次
              const roundNum = evt.round;
              setCurrentRound(roundNum);
              evt.agent_ids.forEach((id) => {
                agentRoundRef.current[id] = roundNum;
              });
              // 将本轮 Agent 状态更新为 working（等待 agent_start 确认）
              setDeductMessages((prev) =>
                prev.map((m) =>
                  evt.agent_ids!.includes(m.agentId)
                    ? { ...m, round: roundNum, status: "working" }
                    : m
                )
              );
              setNodes((prev) =>
                prev.map((n) =>
                  evt.agent_ids!.includes(n.id) ? { ...n, status: "working" as const } : n
                )
              );
            } else if (evt.type === "agent_waiting" && aid) {
              // Agent 在等待上游完成
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid
                    ? { ...m, status: "waiting", waitingFor: evt.waiting_for ?? [] }
                    : m
                )
              );
              setNodes((prev) =>
                prev.map((n) => n.id === aid ? { ...n, status: "waiting" as const } : n)
              );
            } else if (evt.type === "agent_start" && aid) {
              // Agent 正式开始推演（收到上游输出后）
              const round = agentRoundRef.current[aid] ?? 1;
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid
                    ? { ...m, status: "working", round, waitingFor: undefined }
                    : m
                )
              );
              setNodes((prev) =>
                prev.map((n) => n.id === aid ? { ...n, status: "working" as const } : n)
              );
            } else if (evt.type === "delta" && aid && evt.content) {
              // 追加文字到对应 Agent 的消息
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid
                    ? { ...m, text: m.text + evt.content, status: "working" }
                    : m
                )
              );
              // 自动滚动到底部
              requestAnimationFrame(() => {
                if (deductPanelRef.current) {
                  deductPanelRef.current.scrollTop = deductPanelRef.current.scrollHeight;
                }
              });
            } else if (evt.type === "agent_done" && aid) {
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid
                    ? { ...m, status: "done", text: evt.full_text ?? m.text }
                    : m
                )
              );
              setNodes((prev) =>
                prev.map((n) => n.id === aid ? { ...n, status: "done" as const } : n)
              );
            } else if (evt.type === "agent_error" && aid) {
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid
                    ? { ...m, status: "error", errorMsg: evt.message ?? "推演失败" }
                    : m
                )
              );
              setNodes((prev) =>
                prev.map((n) => n.id === aid ? { ...n, status: "error" as const } : n)
              );
            } else if (evt.type === "all_done") {
              // 用 ref 暂存最终消息，由 useEffect 在渲染后统一触发父组件回调
              setDeductMessages((finalMsgs) => {
                pendingDoneRef.current = { msgs: finalMsgs, mode: "graph", organizerSummary: null };
                return finalMsgs;
              });
              setDeductPhase("done");
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      }
      // 流结束时若未收到 all_done 事件，也触发完成回调
      setDeductMessages((finalMsgs) => {
        pendingDoneRef.current = { msgs: finalMsgs, mode: "graph", organizerSummary: null };
        return finalMsgs;
      });
      setDeductPhase((phase) => (phase !== "done" ? "done" : phase));
    } catch (err) {
      setDeductError(err instanceof Error ? err.message : "网络错误");
      setDeductPhase("idle");
      setNodes((prev) => prev.map((n) => ({ ...n, status: "idle" as const })));
    }
  }, [nodes, topic, apiKeys, edges]);

  // ── 开始研讨会推演：调用 /v1/discussion SSE（多轮交流 + 组织者总结）──
  const handleStartDiscussion = useCallback(async () => {
    if (nodes.length === 0 || !organizerId) return;
    setDeductPhase("running");
    setDeductError("");
    setSummary("");
    setCurrentRound(1);
    setOrganizerSummary(null);
    setOrganizerDecisions([]);
    agentRoundRef.current = {};

    // 初始化普通 Agent 消息（不含组织者，组织者最后单独展示）
    const memberNodes = nodes.filter((n) => n.id !== organizerId);
    const initMsgs: DeductionMessage[] = memberNodes.map((n) => ({
      id: n.id,
      agentId: n.id,
      agentName: n.agent.name,
      agentColor: n.agent.iconColor,
      agentIcon: n.agent.iconName,
      text: "",
      status: "waiting",
      timestamp: Date.now(),
      round: 1,
    }));
    setDeductMessages(initMsgs);

    // 更新星图节点状态
    setNodes((prev) => prev.map((n) => ({
      ...n,
      status: n.id === organizerId ? "idle" as const : "waiting" as const,
    })));

    // 构造请求体
    const agentsPayload = nodes.map((n) => {
      const model = n.agent.model;
      const key =
        apiKeys.find((k) => k.modelName === model) ??
        apiKeys.find((k) => k.isActive) ??
        apiKeys[0];
      return {
        id: n.id,
        name: n.agent.name,
        model,
        system_prompt: n.agent.systemPrompt ?? "",
        role: n.role ?? "",
        task_prompt: n.taskPrompt ?? "",
        api_key: key?.keyValue ?? "",
        base_url: key?.baseUrl ?? null,
        extra_headers: key?.extraHeaders ?? null,
      };
    });

    try {
      const resp = await fetch("http://localhost:8000/v1/discussion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          agents: agentsPayload,
          organizer_id: organizerId,
          discussion_rounds: 2,
        }),
      });

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          try {
            const evt = JSON.parse(raw) as {
              type: string;
              agent_id?: string;
              agent_ids?: string[];
                content?: string;
                full_text?: string;
                message?: string;
                round?: number;
                label?: string;
                "continue"?: boolean;
                reason?: string;
              };
              const aid = evt.agent_id;
  
              if (evt.type === "organizer_decision") {
                // 组织者裁判决策：记录到列表，UI 中在对应轮次后展示
                const decisionRound = evt.round ?? 1;
                const shouldContinue = evt["continue"] ?? false;
                const reason = evt.reason ?? "";
                setOrganizerDecisions((prev) => [
                  ...prev.filter((d) => d.round !== decisionRound),
                  { round: decisionRound, continue: shouldContinue, reason },
                ]);
              } else if (evt.type === "discussion_round_start") {
                const roundNum = evt.round ?? 1;
                setCurrentRound(roundNum);
  
                if (roundNum === 0) {
                  // 组织者总结阶段开始
                  setOrganizerSummary({ text: "", status: "working" });
                  setNodes((prev) => prev.map((n) =>
                    n.id === organizerId ? { ...n, status: "working" as const } : n
                  ));
                } else {
                  // 普通讨论轮次（Round 1 初始化，Round 2+ 新增消息）
                  const roundAgentIds = evt.agent_ids ?? [];
                  roundAgentIds.forEach((id) => { agentRoundRef.current[id] = roundNum; });
  
                  if (roundNum === 1) {
                    // Round 1：更新已有消息的 round 字段
                    setDeductMessages((prev) =>
                      prev.map((m) =>
                        roundAgentIds.includes(m.agentId)
                          ? { ...m, round: 1, status: "working" }
                          : m
                      )
                    );
                  } else {
                    // Round 2+：为每个 Agent 新增一条新轮次消息
                    setDeductMessages((prev) => {
                      const existing = new Set(
                        prev.filter((m) => m.round === roundNum).map((m) => m.agentId)
                      );
                      const newMsgs: DeductionMessage[] = roundAgentIds
                        .filter((id) => !existing.has(id))
                        .map((id) => {
                          const node = nodes.find((n) => n.id === id);
                          return {
                            id: `${id}-r${roundNum}`,
                            agentId: id,
                            agentName: node?.agent.name ?? id,
                            agentColor: node?.agent.iconColor ?? "#6b7280",
                            agentIcon: node?.agent.iconName ?? "A",
                            text: "",
                            status: "working" as const,
                            timestamp: Date.now(),
                            round: roundNum,
                          };
                        });
                      return [...prev, ...newMsgs];
                    });
                  }
                  setNodes((prev) => prev.map((n) =>
                    roundAgentIds.includes(n.id) ? { ...n, status: "working" as const } : n
                  ));
                }
            } else if (evt.type === "agent_start" && aid) {
              const round = evt.round ?? agentRoundRef.current[aid] ?? 1;
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid && m.round === round
                    ? { ...m, status: "working", waitingFor: undefined }
                    : m
                )
              );
              setNodes((prev) => prev.map((n) =>
                n.id === aid ? { ...n, status: "working" as const } : n
              ));
            } else if (evt.type === "delta" && aid && evt.content) {
              const round = evt.round ?? agentRoundRef.current[aid] ?? 1;
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid && m.round === round
                    ? { ...m, text: m.text + evt.content, status: "working" }
                    : m
                )
              );
              requestAnimationFrame(() => {
                if (deductPanelRef.current) {
                  deductPanelRef.current.scrollTop = deductPanelRef.current.scrollHeight;
                }
              });
            } else if (evt.type === "agent_done" && aid) {
              const round = evt.round ?? agentRoundRef.current[aid] ?? 1;
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid && m.round === round
                    ? { ...m, status: "done", text: evt.full_text ?? m.text }
                    : m
                )
              );
              setNodes((prev) => prev.map((n) =>
                n.id === aid ? { ...n, status: "done" as const } : n
              ));
            } else if (evt.type === "agent_error" && aid) {
              const round = evt.round ?? agentRoundRef.current[aid] ?? 1;
              setDeductMessages((prev) =>
                prev.map((m) =>
                  m.agentId === aid && m.round === round
                    ? { ...m, status: "error", errorMsg: evt.message ?? "推演失败" }
                    : m
                )
              );
              setNodes((prev) => prev.map((n) =>
                n.id === aid ? { ...n, status: "error" as const } : n
              ));
            } else if (evt.type === "organizer_start") {
              setOrganizerSummary({ text: "", status: "working" });
              if (aid) {
                setNodes((prev) => prev.map((n) =>
                  n.id === aid ? { ...n, status: "working" as const } : n
                ));
              }
            } else if (evt.type === "organizer_delta" && evt.content) {
              setOrganizerSummary((prev) =>
                prev ? { ...prev, text: prev.text + evt.content } : { text: evt.content!, status: "working" }
              );
              requestAnimationFrame(() => {
                if (deductPanelRef.current) {
                  deductPanelRef.current.scrollTop = deductPanelRef.current.scrollHeight;
                }
              });
            } else if (evt.type === "organizer_done") {
              setOrganizerSummary((prev) =>
                prev ? { ...prev, text: evt.full_text ?? prev.text, status: "done" } : null
              );
              if (aid) {
                setNodes((prev) => prev.map((n) =>
                  n.id === aid ? { ...n, status: "done" as const } : n
                ));
              }
            } else if (evt.type === "all_done") {
              // 研讨会模式：把 organizerSummary 一起打包进结果
              setOrganizerSummary((latestSummary) => {
                const orgNode = nodes.find((n) => n.id === organizerId);
                setDeductMessages((finalMsgs) => {
                  pendingDoneRef.current = {
                    msgs: finalMsgs,
                    mode: "discussion",
                    organizerSummary: latestSummary ? {
                      agentId: organizerId ?? "",
                      agentName: orgNode?.agent.name ?? "组织者",
                      agentColor: orgNode?.agent.iconColor ?? "#f59e0b",
                      agentIcon: orgNode?.agent.iconName ?? "O",
                      text: latestSummary.text,
                    } : null,
                  };
                  return finalMsgs;
                });
                return latestSummary;
              });
              setDeductPhase("done");
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      }
      // 流结束时若未收到 all_done 事件，也触发完成回调
      setOrganizerSummary((latestSummary) => {
        const orgNode = nodes.find((n) => n.id === organizerId);
        setDeductMessages((finalMsgs) => {
          pendingDoneRef.current = {
            msgs: finalMsgs,
            mode: "discussion",
            organizerSummary: latestSummary ? {
              agentId: organizerId ?? "",
              agentName: orgNode?.agent.name ?? "组织者",
              agentColor: orgNode?.agent.iconColor ?? "#f59e0b",
              agentIcon: orgNode?.agent.iconName ?? "O",
              text: latestSummary.text,
            } : null,
          };
          return finalMsgs;
        });
        return latestSummary;
      });
      setDeductPhase((phase) => (phase !== "done" ? "done" : phase));
    } catch (err) {
      setDeductError(err instanceof Error ? err.message : "网络错误");
      setDeductPhase("idle");
      setNodes((prev) => prev.map((n) => ({ ...n, status: "idle" as const })));
    }
  }, [nodes, topic, apiKeys, organizerId]);

  // ── 开始组织：调用 /v1/organize SSE ──
  const handleStartOrganize = useCallback(async () => {
    if (!organizerId) return;
    setOrganizePhase("organizing");
    setOrganizeThinking("");
    setOrganizeError("");

    // 根据组织者的模型自动匹配 API Key：
    // 1. 优先找 modelName 与组织者模型完全匹配的 key
    // 2. 其次用 isActive 的 key
    // 3. 最后用第一个 key
    const organizerAgent = nodes.find((n) => n.id === organizerId);
    const model = organizerAgent?.agent.model || "gpt-4o";
    const selectedKey =
      apiKeys.find((k) => k.modelName === model) ??
      apiKeys.find((k) => k.isActive) ??
      apiKeys[0];

    // 构造 AgentInfo 列表（当前星图中的节点）
    const agentInfos = nodes.map((n) => ({
      id: n.id,
      name: n.agent.name,
      model: n.agent.model,
      system_prompt: n.agent.systemPrompt ?? "",
    }));

    try {
      const resp = await fetch("http://localhost:8000/v1/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizer_id: organizerId,
          agents: agentInfos,
          topic,
          organizer_prompt: organizerPrompt || "",
          model,
          api_key: selectedKey?.keyValue ?? "",
          base_url: selectedKey?.baseUrl ?? null,
          extra_headers: selectedKey?.extraHeaders ?? null,
          provider: selectedKey ? (selectedKey.keyValue.startsWith("sk-ant-") ? "anthropic" : "openai") : null,
        }),
      });

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 按行解析 SSE
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;

          try {
            const evt = JSON.parse(raw) as {
              type: "thinking_delta" | "done" | "error";
              content?: string;   // thinking_delta
              message?: string;   // error
              result?: OrganizeResult;
            };

            if (evt.type === "thinking_delta" && evt.content) {
              setOrganizeThinking((prev) => prev + evt.content);
            } else if (evt.type === "done" && evt.result) {
              // 更新节点的 role / taskPrompt / reportsTo
              const roleMap: Record<string, OrganizeRole> = {};
              evt.result.roles.forEach((r) => { roleMap[r.agent_id] = r; });

              // 先计算更新后的 nodes（同步），再传给 onOrganizeDone
              const updatedNodes = nodes.map((n) => {
                const r = roleMap[n.id];
                if (!r) return n;
                return {
                  ...n,
                  role: r.role,
                  taskPrompt: r.task_prompt,
                  reportsTo: r.reports_to,
                };
              });

              setNodes(updatedNodes);
              setEdges(evt.result.edges);
              setOrganizePhase("done");
              onOrganizeDone();
            } else if (evt.type === "error") {
              setOrganizeError(evt.message ?? evt.content ?? "未知错误");
              setOrganizePhase("setup");
            }
          } catch {
            // JSON 解析失败，跳过
          }
        }
      }
    } catch (err) {
      setOrganizeError(err instanceof Error ? err.message : "网络错误");
      setOrganizePhase("setup");
    }
  }, [organizerId, nodes, topic, organizerPrompt, apiKeys]);

  // 当前详情节点
  const detailNode = detailNodeId ? nodes.find((n) => n.id === detailNodeId) ?? null : null;

  const doneCount = deductMessages.filter((m) => m.status === "done").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 议题条 */}
      <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--border-subtle)", backgroundColor: "rgba(10,14,26,0.6)", flexShrink: 0, display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "10px", color: "var(--text-muted)", flexShrink: 0 }}>议题</span>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {topic}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
          {/* 推演进度 */}
          {deductPhase !== "idle" && (
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              {deductPhase === "running"
                ? <Loader2 size={11} style={{ color: "var(--accent-blue)", animation: "spin 1s linear infinite" }} />
                : <Check size={11} style={{ color: "#22c55e" }} />
              }
              <span style={{ fontSize: "11px", color: deductPhase === "done" ? "#22c55e" : "var(--accent-blue)" }}>
                {deductPhase === "done" ? `推演完成 · ${doneCount}/${nodes.length}` : `推演中 ${doneCount}/${nodes.length}`}
              </span>
            </div>
          )}
          {/* 组织完成后显示模式选择 + 「开始推演」按钮 */}
          {organizePhase === "done" && deductPhase === "idle" && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {/* 模式切换 */}
              <div style={{
                display: "flex", borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                overflow: "hidden", flexShrink: 0,
              }}>
                {([
                  { key: "discussion", label: "研讨会", title: "多轮交流：Agent 互相回应，组织者最终总结" },
                  { key: "graph",      label: "图推演", title: "图结构：按依赖关系顺序推演" },
                ] as const).map((m) => (
                  <button
                    key={m.key}
                    title={m.title}
                    onClick={() => setDeductMode(m.key)}
                    style={{
                      padding: "4px 9px", border: "none", cursor: "pointer",
                      fontSize: "10px", fontWeight: 600,
                      backgroundColor: deductMode === m.key ? "var(--accent-blue)" : "transparent",
                      color: deductMode === m.key ? "#fff" : "var(--text-muted)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {/* 开始推演按钮 */}
              <button
                onClick={deductMode === "discussion" ? handleStartDiscussion : handleStartDeduction}
                style={{
                  display: "flex", alignItems: "center", gap: "4px",
                  padding: "5px 12px", borderRadius: "6px",
                  border: "none", backgroundColor: "var(--accent-blue)",
                  color: "#fff", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                }}
              >
                <Zap size={11} />开始推演
              </button>
            </div>
          )}
          {/* 推演完成后可重新推演 */}
          {deductPhase === "done" && (
            <button
              onClick={() => { setDeductPhase("idle"); setDeductMessages([]); setNodes((prev) => prev.map((n) => ({ ...n, status: "idle" as const }))); }}
              style={{
                display: "flex", alignItems: "center", gap: "4px",
                padding: "5px 12px", borderRadius: "6px",
                border: "1px solid var(--border-subtle)", backgroundColor: "transparent",
                color: "var(--text-secondary)", fontSize: "11px", cursor: "pointer",
              }}
            >
              <Zap size={11} />重新推演
            </button>
          )}
          {/* 推演完成后显示「查看结果」按钮 */}
          {deductPhase === "done" && (
            <button
              onClick={() => {
                const orgNode = nodes.find((n) => n.id === organizerId);
                onDeductDone({
                  msgs: deductMessages,
                  mode: deductMode,
                  organizerSummary: organizerSummary ? {
                    agentId: organizerId ?? "",
                    agentName: orgNode?.agent.name ?? "组织者",
                    agentColor: orgNode?.agent.iconColor ?? "#f59e0b",
                    agentIcon: orgNode?.agent.iconName ?? "O",
                    text: organizerSummary.text,
                  } : null,
                });
              }}
              style={{
                display: "flex", alignItems: "center", gap: "4px",
                padding: "5px 12px", borderRadius: "6px",
                border: "none", backgroundColor: "#f59e0b",
                color: "#fff", fontSize: "11px", fontWeight: 600, cursor: "pointer",
              }}
            >
              <Trophy size={11} />查看结果
            </button>
          )}
        </div>
      </div>

      {/* 主体：左侧组织面板 + 中间星图 + 右侧推演对话流 */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── 左侧：组织阶段面板（仅组织未完成时显示） ── */}
        {organizePhase !== "done" && (
          <div
            style={{
              width: "300px",
              flexShrink: 0,
              borderRight: "1px solid var(--border-subtle)",
              backgroundColor: "rgba(10,14,26,0.92)",
              display: "flex",
              flexDirection: "column",
              backdropFilter: "blur(12px)",
            }}
          >
            {/* 面板头 */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                <Sparkles size={13} style={{ color: "#f59e0b" }} />
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
                  组织阶段
                </span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                由组织者 Agent 分析议题，为每位成员分配职位和任务
              </p>
            </div>

            {/* 面板内容 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "14px" }}>

              {/* 组织者信息 */}
              {organizerId && (() => {
                const org = agents.find((a) => a.id === organizerId);
                if (!org) return null;
                return (
                  <div>
                    <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                      组织者
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", backgroundColor: "#f59e0b12", border: "1px solid #f59e0b30" }}>
                      <div style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: org.iconColor + "33", border: `2px solid ${org.iconColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#fff", flexShrink: 0 }}>
                        {org.iconName.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: org.iconColor }}>{org.name}</div>
                        <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>{org.model}</div>
                      </div>
                      <Crown size={12} style={{ color: "#f59e0b", marginLeft: "auto" }} />
                    </div>
                  </div>
                );
              })()}

              {/* 错误提示 */}
              {organizeError && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: "7px", padding: "10px", borderRadius: "8px", backgroundColor: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <AlertCircle size={13} style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }} />
                  <span style={{ fontSize: "11px", color: "#ef4444", lineHeight: 1.5 }}>{organizeError}</span>
                </div>
              )}

              {/* Prompt 模版选择 */}
              {templates.length > 0 && organizePhase === "setup" && (
                <div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                    快速模版
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setOrganizerPrompt(t.prompt)}
                        style={{
                          textAlign: "left",
                          padding: "7px 10px",
                          borderRadius: "7px",
                          border: "1px solid var(--border-subtle)",
                          backgroundColor: organizerPrompt === t.prompt ? "rgba(59,130,246,0.12)" : "transparent",
                          color: organizerPrompt === t.prompt ? "var(--accent-blue)" : "var(--text-secondary)",
                          fontSize: "11px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <FileText size={11} style={{ flexShrink: 0 }} />
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Prompt 编辑区 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <label style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "6px" }}>
                  组织指令（可选）
                </label>
                {organizePhase === "setup" ? (
                  <textarea
                    value={organizerPrompt}
                    onChange={(e) => setOrganizerPrompt(e.target.value)}
                    placeholder={`描述本次推演的目标和要求，组织者将据此分配角色...\n\n留空则使用默认指令。`}
                    rows={6}
                    style={{
                      flex: 1,
                      width: "100%",
                      padding: "9px 10px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-subtle)",
                      backgroundColor: "rgba(255,255,255,0.04)",
                      color: "var(--text-primary)",
                      fontSize: "12px",
                      lineHeight: 1.6,
                      outline: "none",
                      resize: "vertical",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                    }}
                  />
                ) : (
                  /* organizing 状态：显示 thinking 流 */
                  <div
                    style={{
                      flex: 1,
                      padding: "10px",
                      borderRadius: "8px",
                      border: "1px solid rgba(59,130,246,0.25)",
                      backgroundColor: "rgba(59,130,246,0.05)",
                      overflowY: "auto",
                      minHeight: "120px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                      <Loader2 size={11} style={{ color: "var(--accent-blue)", animation: "spin 1s linear infinite" }} />
                      <span style={{ fontSize: "10px", color: "var(--accent-blue)", fontWeight: 600 }}>
                        组织者正在思考...
                      </span>
                    </div>
                    <p style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>
                      {organizeThinking || "等待响应..."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 底部按钮 */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0 }}>
              {organizePhase === "setup" ? (
                <button
                  onClick={handleStartOrganize}
                  disabled={!organizerId || nodes.length < 2}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: (!organizerId || nodes.length < 2) ? "rgba(59,130,246,0.3)" : "var(--accent-blue)",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: (!organizerId || nodes.length < 2) ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <Sparkles size={13} />
                  {!organizerId ? "请先设置组织者" : nodes.length < 2 ? "至少需要 2 个 Agent" : "开始组织"}
                </button>
              ) : (
                <button
                  disabled
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: "8px",
                    border: "none",
                    backgroundColor: "rgba(59,130,246,0.2)",
                    color: "var(--accent-blue)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                  组织中...
                </button>
              )}
              {organizePhase === "setup" && (
                <p style={{ fontSize: "10px", color: "var(--text-muted)", textAlign: "center", margin: "8px 0 0", opacity: 0.7 }}>
                  组织完成后可点击节点查看/编辑分配结果
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── 中间：星图区域 ── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {/* 深色宇宙背景 */}
          <div
            style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse at 50% 40%, rgba(15,23,42,1) 0%, rgba(7,10,20,1) 100%)",
            }}
          />
          <StarField />

          {/* Canvas 连线 + 粒子层 */}
          <div
            ref={containerRef}
            style={{
              position: "absolute", inset: 0,
              outline: isDragOver ? "2px dashed rgba(59,130,246,0.5)" : "none",
              transition: "outline 0.15s ease",
            }}
            onDragOver={(e) => {
              const types = e.dataTransfer.types;
              if (types.includes("agentid")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setIsDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDragOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const agentId = e.dataTransfer.getData("agentId");
              if (agentId && !e.dataTransfer.getData("nodeId")) {
                handleAddFromDock(agentId, e.clientX, e.clientY);
              }
            }}
          >
            <MeshCanvas nodes={nodes} canvasSize={canvasSize} particlesRef={particlesRef} edges={edges.length > 0 ? edges : undefined} />

            {/* Edge label 层 */}
            {edges.length > 0 && edges.map((edge, i) => {
              const a = nodes.find((n) => n.id === edge.from);
              const b = nodes.find((n) => n.id === edge.to);
              if (!a || !b || !edge.label) return null;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const short = edge.label.length > 10 ? edge.label.slice(0, 10) + "…" : edge.label;
              return (
                <div key={i} title={edge.label} style={{ position: "absolute", left: mx, top: my, transform: "translate(-50%, -50%)", pointerEvents: "auto", cursor: "default", zIndex: 5 }}>
                  <div style={{ padding: "2px 7px", borderRadius: "10px", backgroundColor: "rgba(15,23,42,0.75)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(6px)", fontSize: "9px", fontWeight: 500, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap", letterSpacing: "0.01em", userSelect: "none" }}>
                    {short}
                  </div>
                </div>
              );
            })}

            {/* 空状态提示 */}
            {nodes.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", pointerEvents: "none" }}>
                <div style={{ fontSize: "32px", opacity: 0.2 }}>✦</div>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", opacity: 0.5 }}>从下方 Dock 点击或拖入 Agent</p>
              </div>
            )}

            {/* Agent 节点 */}
            {nodes.map((node) => (
              <MeshNode key={node.id} node={node} onDragStart={handleDragStart} onClick={handleNodeClick} />
            ))}
          </div>

          {/* 组织完成提示条（推演未开始时显示） */}
          {organizePhase === "done" && deductPhase === "idle" && (
            <div style={{ position: "absolute", top: "12px", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "7px", padding: "6px 14px", borderRadius: "20px", backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", backdropFilter: "blur(8px)", pointerEvents: "none" }}>
              <Check size={11} style={{ color: "#22c55e" }} />
              <span style={{ fontSize: "11px", color: "#22c55e", fontWeight: 600 }}>
                组织完成 · 点击节点查看分配详情，或点击「开始推演」
              </span>
            </div>
          )}

          {/* 图例 */}
          <div style={{ position: "absolute", bottom: "12px", left: "16px", display: "flex", alignItems: "center", gap: "12px", fontSize: "10px", color: "var(--text-muted)", backgroundColor: "rgba(0,0,0,0.4)", padding: "5px 10px", borderRadius: "6px", backdropFilter: "blur(4px)" }}>
            {[{ color: "#6b7280", label: "空闲" }, { color: "#f59e0b", label: "等待中" }, { color: "#3b82f6", label: "工作中" }, { color: "#22c55e", label: "完成" }, { color: "#ef4444", label: "错误" }].map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: s.color }} />
                {s.label}
              </div>
            ))}
          </div>

          {/* 节点详情弹窗 */}
          {detailNode && (
            <NodeDetailPanel key={detailNode.id} node={detailNode} nodes={nodes} onClose={() => setDetailNodeId(null)} onSave={handleSaveNodeDetail} />
          )}
        </div>

        {/* ── 右侧：推演实时对话流面板（推演开始后展开） ── */}
        {deductPhase !== "idle" && (
          <div
            style={{
              width: "380px",
              flexShrink: 0,
              borderLeft: "1px solid var(--border-subtle)",
              backgroundColor: "rgba(10,14,26,0.95)",
              display: "flex",
              flexDirection: "column",
              backdropFilter: "blur(16px)",
            }}
          >
            {/* 面板头 */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <MessageSquare size={13} style={{ color: "var(--accent-blue)" }} />
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
                推演对话流
              </span>
              {deductPhase === "running" && (
                <Loader2 size={12} style={{ color: "var(--accent-blue)", animation: "spin 1s linear infinite" }} />
              )}
              {deductPhase === "done" && (
                <Check size={12} style={{ color: "#22c55e" }} />
              )}
            </div>

            {/* 推演错误 */}
            {deductError && (
              <div style={{ padding: "8px 14px", backgroundColor: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                <AlertCircle size={11} style={{ color: "#ef4444" }} />
                <span style={{ fontSize: "11px", color: "#ef4444" }}>{deductError}</span>
              </div>
            )}

            {/* 对话流列表（按轮次分组） */}
            <div
              ref={deductPanelRef}
              style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "0" }}
            >
              {(() => {
                // 按轮次分组
                const rounds: Record<number, DeductionMessage[]> = {};
                deductMessages.forEach((msg) => {
                  const r = msg.round ?? 1;
                  if (!rounds[r]) rounds[r] = [];
                  rounds[r].push(msg);
                });
                const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);

                // 研讨会模式的轮次标签
                const getRoundLabel = (roundNum: number) => {
                  if (deductMode === "discussion") {
                    const ordinals = ["", "一", "二", "三", "四", "五"];
                    const ord = ordinals[roundNum] ?? roundNum;
                    if (roundNum === 1) return `第${ord}轮 · 初步发言`;
                    return `第${ord}轮 · 深化讨论`;
                  }
                  return `第 ${roundNum} 轮`;
                };

                return roundNums.map((roundNum) => {
                  // 该轮结束后的组织者决策
                  const decision = organizerDecisions.find((d) => d.round === roundNum);

                  return (
                  <div key={roundNum} style={{ marginBottom: "4px" }}>
                    {/* 轮次分隔线 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                      <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)" }} />
                      <span style={{
                        fontSize: "9px", fontWeight: 700, color: "var(--text-muted)",
                        textTransform: "uppercase", letterSpacing: "0.08em",
                        padding: "2px 8px", borderRadius: "10px",
                        backgroundColor: "rgba(59,130,246,0.08)",
                        border: "1px solid rgba(59,130,246,0.15)",
                        whiteSpace: "nowrap",
                      }}>
                        {getRoundLabel(roundNum)}
                      </span>
                      <div style={{ flex: 1, height: "1px", backgroundColor: "var(--border-subtle)" }} />
                    </div>

                    {/* 本轮 Agent 消息 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {rounds[roundNum].map((msg) => (
                        <div key={`${msg.agentId}-${msg.round}`} style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                          {/* Agent 头部 */}
                          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                            <div style={{
                              width: "22px", height: "22px", borderRadius: "50%",
                              backgroundColor: msg.agentColor + "33",
                              border: `1.5px solid ${msg.status === "waiting" ? "rgba(107,114,128,0.5)" : msg.agentColor}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "9px", fontWeight: 700, color: "#fff", flexShrink: 0,
                              opacity: msg.status === "waiting" ? 0.5 : 1,
                              transition: "all 0.3s ease",
                            }}>
                              {msg.agentIcon.slice(0, 1).toUpperCase()}
                            </div>
                            <span style={{
                              fontSize: "12px", fontWeight: 600,
                              color: msg.status === "waiting" ? "var(--text-muted)" : msg.agentColor,
                              transition: "color 0.3s ease",
                            }}>
                              {msg.agentName}
                            </span>
                            {/* 状态图标 */}
                            {msg.status === "waiting" && (
                              <span style={{ fontSize: "9px", color: "var(--text-muted)", marginLeft: "2px", fontStyle: "italic" }}>
                                {deductMode === "discussion" ? "准备发言..." : "等待上游..."}
                              </span>
                            )}
                            {msg.status === "working" && (
                              <Loader2 size={10} style={{ color: "var(--accent-blue)", animation: "spin 1s linear infinite", marginLeft: "2px" }} />
                            )}
                            {msg.status === "done" && (
                              <Check size={10} style={{ color: "#22c55e", marginLeft: "2px" }} />
                            )}
                          </div>

                          {/* 等待状态：显示等待哪些上游（图推演模式） */}
                          {msg.status === "waiting" && msg.waitingFor && msg.waitingFor.length > 0 && deductMode === "graph" && (
                            <div style={{
                              marginLeft: "29px",
                              padding: "6px 10px",
                              borderRadius: "0 8px 8px 8px",
                              backgroundColor: "rgba(107,114,128,0.06)",
                              border: "1px dashed rgba(107,114,128,0.2)",
                              fontSize: "10px",
                              color: "var(--text-muted)",
                              fontStyle: "italic",
                            }}>
                              ⏳ 等待{" "}
                              {msg.waitingFor.map((wid) => {
                                const wMsg = deductMessages.find((m) => m.agentId === wid);
                                return wMsg?.agentName ?? wid;
                              }).join("、")}{" "}
                              完成分析...
                            </div>
                          )}

                          {/* 工作中 / 完成 / 错误：显示内容气泡 */}
                          {msg.status !== "waiting" && (
                            <div
                              style={{
                                marginLeft: "29px",
                                padding: "10px 12px",
                                borderRadius: "0 10px 10px 10px",
                                backgroundColor: msg.agentColor + "0d",
                                border: `1px solid ${msg.agentColor}22`,
                                fontSize: "12px",
                                color: "var(--text-secondary)",
                                lineHeight: 1.75,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                minHeight: "36px",
                              }}
                            >
                              {msg.status === "error" ? (
                                <span style={{ color: "#ef4444" }}>{msg.errorMsg ?? "推演失败"}</span>
                              ) : msg.text ? (
                                <>
                                  {msg.text}
                                  {msg.status === "working" && (
                                    <span style={{ display: "inline-block", width: "2px", height: "13px", backgroundColor: msg.agentColor, marginLeft: "2px", animation: "blink 0.8s ease-in-out infinite", verticalAlign: "text-bottom" }} />
                                  )}
                                </>
                              ) : (
                                <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>准备中...</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 组织者裁判决策卡片（每轮结束后显示） */}
                    {deductMode === "discussion" && decision && (() => {
                      const orgNode = nodes.find((n) => n.id === organizerId);
                      const orgColor = orgNode?.agent.iconColor ?? "#f59e0b";
                      const orgName  = orgNode?.agent.name ?? "组织者";
                      const orgIcon  = orgNode?.agent.iconName ?? "O";
                      return (
                        <div style={{ marginTop: "12px", marginBottom: "4px" }}>
                          {/* 决策分隔线 */}
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <div style={{ flex: 1, height: "1px", backgroundColor: decision.continue ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)" }} />
                            <span style={{
                              fontSize: "9px", fontWeight: 700,
                              color: decision.continue ? "var(--accent-blue)" : "#f59e0b",
                              padding: "2px 8px", borderRadius: "10px",
                              backgroundColor: decision.continue ? "rgba(59,130,246,0.08)" : "rgba(245,158,11,0.08)",
                              border: `1px solid ${decision.continue ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)"}`,
                              whiteSpace: "nowrap",
                              display: "flex", alignItems: "center", gap: "4px",
                            }}>
                              <Crown size={8} />
                              组织者裁判
                            </span>
                            <div style={{ flex: 1, height: "1px", backgroundColor: decision.continue ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)" }} />
                          </div>

                          {/* 决策卡片 */}
                          <div style={{
                            display: "flex", alignItems: "flex-start", gap: "8px",
                            padding: "10px 12px", borderRadius: "10px",
                            backgroundColor: decision.continue ? "rgba(59,130,246,0.06)" : "rgba(245,158,11,0.06)",
                            border: `1px solid ${decision.continue ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)"}`,
                          }}>
                            {/* 组织者头像 */}
                            <div style={{
                              width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
                              backgroundColor: orgColor + "33", border: `1.5px solid ${orgColor}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "8px", fontWeight: 700, color: "#fff",
                            }}>
                              {orgIcon.slice(0, 1).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                                <span style={{ fontSize: "11px", fontWeight: 600, color: orgColor }}>{orgName}</span>
                                {/* 决策徽章 */}
                                <div style={{
                                  display: "flex", alignItems: "center", gap: "3px",
                                  padding: "1px 7px", borderRadius: "8px",
                                  backgroundColor: decision.continue ? "rgba(59,130,246,0.15)" : "rgba(245,158,11,0.15)",
                                  border: `1px solid ${decision.continue ? "rgba(59,130,246,0.35)" : "rgba(245,158,11,0.35)"}`,
                                }}>
                                  {decision.continue ? (
                                    <>
                                      <RefreshCw size={8} style={{ color: "var(--accent-blue)" }} />
                                      <span style={{ fontSize: "9px", fontWeight: 700, color: "var(--accent-blue)" }}>继续下一轮</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check size={8} style={{ color: "#f59e0b" }} />
                                      <span style={{ fontSize: "9px", fontWeight: 700, color: "#f59e0b" }}>讨论充分，进入总结</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <p style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0, fontStyle: "italic" }}>
                                {decision.reason}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  );
                });
              })()}

              {/* 研讨会模式：组织者最终总结 */}
              {deductMode === "discussion" && organizerSummary && (() => {
                const orgNode = nodes.find((n) => n.id === organizerId);
                const orgColor = orgNode?.agent.iconColor ?? "#f59e0b";
                const orgName  = orgNode?.agent.name ?? "组织者";
                const orgIcon  = orgNode?.agent.iconName ?? "O";
                return (
                  <div style={{ marginBottom: "16px" }}>
                    {/* 分隔线 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                      <div style={{ flex: 1, height: "1px", backgroundColor: "rgba(245,158,11,0.3)" }} />
                      <span style={{
                        fontSize: "9px", fontWeight: 700,
                        color: "#f59e0b",
                        padding: "2px 8px", borderRadius: "10px",
                        backgroundColor: "rgba(245,158,11,0.1)",
                        border: "1px solid rgba(245,158,11,0.3)",
                        whiteSpace: "nowrap",
                        display: "flex", alignItems: "center", gap: "4px",
                      }}>
                        <Crown size={9} />
                        组织者综合总结
                      </span>
                      <div style={{ flex: 1, height: "1px", backgroundColor: "rgba(245,158,11,0.3)" }} />
                    </div>

                    {/* 组织者消息 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                        <div style={{
                          width: "22px", height: "22px", borderRadius: "50%",
                          backgroundColor: orgColor + "33",
                          border: `1.5px solid ${orgColor}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "9px", fontWeight: 700, color: "#fff", flexShrink: 0,
                        }}>
                          {orgIcon.slice(0, 1).toUpperCase()}
                        </div>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: orgColor }}>
                          {orgName}
                        </span>
                        <span style={{ fontSize: "9px", color: "#f59e0b", padding: "1px 5px", borderRadius: "4px", backgroundColor: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
                          组织者
                        </span>
                        {organizerSummary.status === "working" && (
                          <Loader2 size={10} style={{ color: "#f59e0b", animation: "spin 1s linear infinite", marginLeft: "2px" }} />
                        )}
                        {organizerSummary.status === "done" && (
                          <Check size={10} style={{ color: "#22c55e", marginLeft: "2px" }} />
                        )}
                      </div>
                      <div style={{
                        marginLeft: "29px",
                        padding: "12px 14px",
                        borderRadius: "0 10px 10px 10px",
                        backgroundColor: "rgba(245,158,11,0.06)",
                        border: "1px solid rgba(245,158,11,0.2)",
                        fontSize: "12px",
                        color: "var(--text-secondary)",
                        lineHeight: 1.8,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        minHeight: "36px",
                      }}>
                        {organizerSummary.text ? (
                          <>
                            {organizerSummary.text}
                            {organizerSummary.status === "working" && (
                              <span style={{ display: "inline-block", width: "2px", height: "13px", backgroundColor: "#f59e0b", marginLeft: "2px", animation: "blink 0.8s ease-in-out infinite", verticalAlign: "text-bottom" }} />
                            )}
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>正在综合所有发言...</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 推演完成提示 */}
              {deductPhase === "done" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", backgroundColor: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", marginTop: "4px" }}>
                  <Check size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                  <span style={{ fontSize: "12px", color: "#22c55e", fontWeight: 600 }}>
                    {deductMode === "discussion"
                      ? `研讨会完成 · ${nodes.length - 1} 位成员 + 组织者总结`
                      : `所有 Agent 推演完成 · 共 ${nodes.length} 位参与`
                    }
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部 Agent Dock（推演进行中隐藏） */}
      {deductPhase === "idle" && (
        <AgentDock
          ref={dockRef}
          agents={agents}
          placedIds={placedIds}
          onAddToCanvas={(id) => handleAddFromDock(id)}
          onDragStart={() => {}}
          onRemoveFromCanvas={handleRemoveNode}
          collapsed={dockCollapsed}
          onToggleCollapse={() => setDockCollapsed((v) => !v)}
          isDragOver={dockDragOver}
        />
      )}

      {/* 底部操作栏 */}
      <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <button onClick={onPrev} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "7px 14px", borderRadius: "8px", border: "1px solid var(--border-subtle)", backgroundColor: "transparent", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}>
          <ChevronLeft size={13} />修改议题
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* 状态文字 */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {organizePhase === "done" ? (
              <>
                <Check size={11} style={{ color: "#22c55e" }} />
                <span style={{ fontSize: "11px", color: "#22c55e" }}>
                  {deductPhase === "done" ? `推演完成 · ${nodes.length} 个 Agent` : `已完成组织 · ${nodes.length} 个 Agent`}
                </span>
              </>
            ) : (
              <>
                <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#22c55e", animation: "blink 1.5s ease-in-out infinite" }} />
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {nodes.length} 个 Agent 在线
                </span>
              </>
            )}
          </div>
          {/* 推演完成后显示「新一轮推演」 */}
          {deductPhase === "done" && (
            <button
              onClick={onRestart}
              style={{ display: "flex", alignItems: "center", gap: "5px", padding: "7px 14px", borderRadius: "8px", border: "1px solid var(--border-subtle)", backgroundColor: "transparent", color: "var(--text-secondary)", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}
            >
              <Zap size={12} />新一轮推演
            </button>
          )}
          {/* 推演完成后显示「查看结果」主按钮 */}
          {deductPhase === "done" && (
            <button
              onClick={() => {
                const orgNode = nodes.find((n) => n.id === organizerId);
                onDeductDone({
                  msgs: deductMessages,
                  mode: deductMode,
                  organizerSummary: organizerSummary ? {
                    agentId: organizerId ?? "",
                    agentName: orgNode?.agent.name ?? "组织者",
                    agentColor: orgNode?.agent.iconColor ?? "#f59e0b",
                    agentIcon: orgNode?.agent.iconName ?? "O",
                    text: organizerSummary.text,
                  } : null,
                });
              }}
              style={{ display: "flex", alignItems: "center", gap: "5px", padding: "7px 16px", borderRadius: "8px", border: "none", backgroundColor: "#f59e0b", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
            >
              <Trophy size={13} />查看结果
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 第 4 页：结果产出（汇总只读页）
// ─────────────────────────────────────────────
function StepResult({
  topic,
  deductResult,
  onPrev,
  onRestart,
}: {
  topic: string;
  deductResult: DeductionResult | null;
  onPrev: () => void;
  onRestart: () => void;
}) {
  const msgs       = deductResult?.msgs ?? [];
  const isDiscussion = deductResult?.mode === "discussion";
  const doneCount  = msgs.filter((m) => m.status === "done").length;
  const errorCount = msgs.filter((m) => m.status === "error").length;
  const totalCount = msgs.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", backgroundColor: "var(--bg-primary)" }}>

      {/* 顶部议题条 */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--border-subtle)", backgroundColor: "rgba(10,14,26,0.7)", flexShrink: 0, display: "flex", alignItems: "center", gap: "12px" }}>
        <Trophy size={14} style={{ color: "#f59e0b", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" }}>
            {isDiscussion ? "研讨会总结" : "推演议题"}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {topic}
          </div>
        </div>
        {/* 统计徽章 */}
        <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
          {isDiscussion ? (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", backgroundColor: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <Users size={10} style={{ color: "#f59e0b" }} />
              <span style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 600 }}>研讨会模式</span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <Check size={10} style={{ color: "#22c55e" }} />
                <span style={{ fontSize: "11px", color: "#22c55e", fontWeight: 600 }}>{doneCount} 完成</span>
              </div>
              {errorCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <AlertCircle size={10} style={{ color: "#ef4444" }} />
                  <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 600 }}>{errorCount} 失败</span>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "3px 10px", borderRadius: "12px", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>共 {totalCount} 位 Agent</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 主体内容 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        {!deductResult ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", opacity: 0.5 }}>
            <Trophy size={40} style={{ color: "var(--text-muted)" }} />
            <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>暂无推演结果</p>
          </div>
        ) : isDiscussion ? (
          /* ── 研讨会模式：只展示组织者综合总结 ── */
          (() => {
            const org = deductResult.organizerSummary;
            if (!org) {
              return (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", opacity: 0.5 }}>
                  <Trophy size={40} style={{ color: "var(--text-muted)" }} />
                  <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>组织者总结尚未生成</p>
                </div>
              );
            }
            return (
              <div style={{ maxWidth: "800px", margin: "0 auto" }}>
                {/* 组织者总结大卡片 */}
                <div
                  style={{
                    borderRadius: "16px",
                    border: "1px solid rgba(245,158,11,0.35)",
                    backgroundColor: "rgba(245,158,11,0.05)",
                    overflow: "hidden",
                  }}
                >
                  {/* 卡片头 */}
                  <div
                    style={{
                      padding: "16px 20px",
                      borderBottom: "1px solid rgba(245,158,11,0.2)",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      background: "linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)",
                    }}
                  >
                    {/* 组织者头像 */}
                    <div
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(245,158,11,0.2)",
                        border: "2px solid #f59e0b",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "#f59e0b",
                        flexShrink: 0,
                      }}
                    >
                      {org.agentIcon.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", fontWeight: 700, color: "#f59e0b" }}>{org.agentName}</div>
                      <div style={{ fontSize: "11px", color: "rgba(245,158,11,0.7)", marginTop: "2px" }}>组织者 · 综合总结</div>
                    </div>
                    {/* 徽章 */}
                    <div
                      style={{
                        display: "flex", alignItems: "center", gap: "5px",
                        padding: "4px 12px", borderRadius: "12px",
                        backgroundColor: "rgba(245,158,11,0.15)",
                        border: "1px solid rgba(245,158,11,0.4)",
                      }}
                    >
                      <Trophy size={11} style={{ color: "#f59e0b" }} />
                      <span style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 600 }}>最终结论</span>
                    </div>
                  </div>
                  {/* 卡片内容 */}
                  <div style={{ padding: "20px 24px" }}>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "var(--text-secondary)",
                        lineHeight: 1.9,
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {org.text || "总结内容生成中…"}
                    </p>
                  </div>
                </div>

                {/* 参与 Agent 小标签列表 */}
                {msgs.length > 0 && (
                  <div style={{ marginTop: "20px" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "10px", fontWeight: 500 }}>
                      参与研讨的 Agent（{[...new Set(msgs.map((m) => m.agentId))].length} 位）
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {[...new Map(msgs.map((m) => [m.agentId, m])).values()].map((m) => (
                        <div
                          key={m.agentId}
                          style={{
                            display: "flex", alignItems: "center", gap: "6px",
                            padding: "4px 10px", borderRadius: "20px",
                            backgroundColor: m.agentColor + "15",
                            border: `1px solid ${m.agentColor}33`,
                          }}
                        >
                          <div
                            style={{
                              width: "18px", height: "18px", borderRadius: "50%",
                              backgroundColor: m.agentColor + "33",
                              border: `1.5px solid ${m.agentColor}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "9px", fontWeight: 700, color: "#fff",
                            }}
                          >
                            {m.agentIcon.slice(0, 1).toUpperCase()}
                          </div>
                          <span style={{ fontSize: "11px", color: m.agentColor, fontWeight: 500 }}>{m.agentName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          /* ── 图推演模式：Agent 结论卡片网格 ── */
          msgs.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px", opacity: 0.5 }}>
              <Trophy size={40} style={{ color: "var(--text-muted)" }} />
              <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>暂无推演结果</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
                gap: "16px",
                alignContent: "start",
              }}
            >
              {msgs.map((msg, idx) => (
                <div
                  key={`${msg.agentId}-${idx}`}
                  style={{
                    borderRadius: "12px",
                    border: `1px solid ${msg.status === "error" ? "rgba(239,68,68,0.3)" : msg.agentColor + "33"}`,
                    backgroundColor: msg.status === "error" ? "rgba(239,68,68,0.05)" : msg.agentColor + "08",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* 卡片头 */}
                  <div
                    style={{
                      padding: "12px 16px",
                      borderBottom: `1px solid ${msg.status === "error" ? "rgba(239,68,68,0.2)" : msg.agentColor + "22"}`,
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      backgroundColor: msg.agentColor + "0d",
                    }}
                  >
                    {/* Agent 头像 */}
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        backgroundColor: msg.agentColor + "33",
                        border: `2px solid ${msg.agentColor}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {msg.agentIcon.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: msg.agentColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {msg.agentName}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "1px" }}>
                        Agent #{idx + 1}
                      </div>
                    </div>
                    {/* 状态标签 */}
                    {msg.status === "done" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "10px", backgroundColor: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", flexShrink: 0 }}>
                        <Check size={9} style={{ color: "#22c55e" }} />
                        <span style={{ fontSize: "10px", color: "#22c55e", fontWeight: 600 }}>完成</span>
                      </div>
                    )}
                    {msg.status === "error" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "10px", backgroundColor: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", flexShrink: 0 }}>
                        <AlertCircle size={9} style={{ color: "#ef4444" }} />
                        <span style={{ fontSize: "10px", color: "#ef4444", fontWeight: 600 }}>失败</span>
                      </div>
                    )}
                    {msg.status === "working" && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "10px", backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", flexShrink: 0 }}>
                        <Loader2 size={9} style={{ color: "var(--accent-blue)", animation: "spin 1s linear infinite" }} />
                        <span style={{ fontSize: "10px", color: "var(--accent-blue)", fontWeight: 600 }}>进行中</span>
                      </div>
                    )}
                  </div>

                  {/* 卡片内容 */}
                  <div style={{ padding: "14px 16px", flex: 1 }}>
                    {msg.status === "error" ? (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                        <AlertCircle size={13} style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }} />
                        <p style={{ fontSize: "12px", color: "#ef4444", lineHeight: 1.6, margin: 0 }}>
                          {msg.errorMsg ?? "推演过程中发生错误"}
                        </p>
                      </div>
                    ) : msg.text ? (
                      <p
                        style={{
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          lineHeight: 1.8,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          maxHeight: "240px",
                          overflowY: "auto",
                        }}
                      >
                        {msg.text}
                      </p>
                    ) : (
                      <p style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", margin: 0 }}>
                        暂无输出
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* 底部操作栏 */}
      <div
        style={{
          padding: "12px 24px",
          borderTop: "1px solid var(--border-subtle)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          backgroundColor: "rgba(10,14,26,0.6)",
        }}
      >
        {/* 左侧：返回推演 */}
        <button
          onClick={onPrev}
          style={{
            display: "flex", alignItems: "center", gap: "5px",
            padding: "7px 14px", borderRadius: "8px",
            border: "1px solid var(--border-subtle)", backgroundColor: "transparent",
            color: "var(--text-secondary)", fontSize: "12px", fontWeight: 500, cursor: "pointer",
          }}
        >
          <ChevronLeft size={13} />返回推演
        </button>

        {/* 右侧：导出 + 新一轮 */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* 导出按钮（预留，暂时 disabled） */}
          <button
            disabled
            title="导出功能即将上线"
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "7px 14px", borderRadius: "8px",
              border: "1px solid var(--border-subtle)", backgroundColor: "transparent",
              color: "var(--text-muted)", fontSize: "12px", fontWeight: 500,
              cursor: "not-allowed", opacity: 0.5,
            }}
          >
            <Download size={13} />导出报告
          </button>
          {/* 新一轮推演 */}
          <button
            onClick={onRestart}
            style={{
              display: "flex", alignItems: "center", gap: "5px",
              padding: "7px 16px", borderRadius: "8px",
              border: "none", backgroundColor: "var(--accent-blue)",
              color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer",
            }}
          >
            <Zap size={13} />新一轮推演
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 星点背景（纯 CSS，无 Canvas 开销）
// ─────────────────────────────────────────────
function StarField() {
  const stars = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.4 + 0.1,
      delay: Math.random() * 3,
    }));
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {stars.map((s) => (
        <div
          key={s.id}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top:  `${s.y}%`,
            width:  s.size,
            height: s.size,
            borderRadius: "50%",
            backgroundColor: "#fff",
            opacity: s.opacity,
            animation: `twinkle 3s ${s.delay}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────
export default function ThinkTankPage() {
  const [step, setStep]               = useState(0);
  const [agents, setAgents]           = useState<AgentRow[]>([]);
  const [loadingAgents, setLoading]   = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [organizerId, setOrganizerId] = useState<string | null>(null);
  const [topic, setTopic]             = useState("");
  const [deductResults, setDeductResults] = useState<DeductionResult | null>(null);

  // 历史存档面板
  const [showHistory, setShowHistory]   = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    agentRepo.list().then((list) => {
      setAgents(list);
      setLoading(false);
    });
    // 初始化时读取存档数量
    setSessionCount(loadSessions().length);
  }, []);

  const toggleAgent = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (organizerId === id) setOrganizerId(null);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [organizerId]);

  const goNext  = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goPrev  = () => setStep((s) => Math.max(s - 1, 0));
  const restart = () => {
    setStep(0);
    setTopic("");
    setSelectedIds(new Set());
    setOrganizerId(null);
    setDeductResults(null);
  };

  // 推演完成时自动保存存档
  const handleDeductDone = useCallback((result: DeductionResult, currentTopic: string) => {
    setDeductResults(result);

    // 构造存档记录
    const msgs = result.msgs;
    const record: SessionRecord = {
      id: Date.now().toString(),
      topic: currentTopic,
      agentNames: [...new Set(msgs.map((m) => m.agentName))],
      agentCount: [...new Set(msgs.map((m) => m.agentId))].length,
      doneCount: msgs.filter((m) => m.status === "done").length,
      messages: msgs,
      createdAt: Date.now(),
    };
    saveSession(record);
    setSessionCount(loadSessions().length);

    goNext();
  }, []);

  // 从历史存档恢复（直接跳到结果页）
  const handleLoadSession = useCallback((record: SessionRecord) => {
    setTopic(record.topic);
    setDeductResults({ msgs: record.messages, mode: "graph", organizerSummary: null });
    setStep(3);
    setShowHistory(false);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "var(--bg-primary)", overflow: "hidden" }}>
      <TopBar
        current={step}
        onOpenHistory={() => setShowHistory(true)}
        sessionCount={sessionCount}
      />

      <div style={{ flex: 1, overflow: "hidden" }}>
        {step === 0 && (
          <StepTeam
            agents={agents}
            selected={selectedIds}
            organizerId={organizerId}
            onToggle={toggleAgent}
            onSetOrganizer={setOrganizerId}
            loading={loadingAgents}
            onNext={goNext}
          />
        )}
        {step === 1 && (
          <StepTopic
            topic={topic}
            onTopicChange={setTopic}
            selectedAgents={selectedIds}
            agents={agents}
            organizerId={organizerId}
            onPrev={goPrev}
            onNext={goNext}
          />
        )}
        {step === 2 && (
          <StepDeduction
            selectedAgents={selectedIds}
            agents={agents}
            organizerId={organizerId}
            topic={topic}
            onPrev={goPrev}
            onRestart={restart}
            onOrganizeDone={() => {/* 组织完成，数据已在 StepDeduction 内部管理 */}}
            onDeductDone={(result) => handleDeductDone(result, topic)}
          />
        )}
        {step === 3 && (
          <StepResult
            topic={topic}
            deductResult={deductResults}
            onPrev={goPrev}
            onRestart={restart}
          />
        )}
      </div>

      {/* 历史存档侧边栏 */}
      {showHistory && (
        <SessionListPanel
          onClose={() => setShowHistory(false)}
          onLoad={handleLoadSession}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        @keyframes twinkle {
          0%, 100% { opacity: var(--op, 0.2); transform: scale(1); }
          50%       { opacity: calc(var(--op, 0.2) * 2.5); transform: scale(1.4); }
        }
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1);    opacity: 0.6; }
          50%       { transform: scale(1.08); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
