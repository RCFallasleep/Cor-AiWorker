"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Plus, SlidersHorizontal, ChevronDown, LayoutGrid, List,
  RefreshCw, X, Search as SearchIcon, BrainCircuit, PenLine, ShieldCheck,
  Zap, BookOpen, Globe, Code2, FileText, Database, ChevronRight,
  Sparkles, Check, Loader2, ExternalLink, AlertCircle, Key, Trash2, Pencil, Save,
  Brain, User, ChevronUp,
} from "lucide-react";
import { agentRepo } from "@/lib/repositories/agent-repository";
import type { AgentRow, AgentSkillScores } from "@/lib/db/idb";
import { apiKeyRepo, type ApiKeyRecord } from "@/lib/repositories/api-key-repository";
import { memoriesApi, type AgentMemory } from "@/lib/api/client";

// ── LiveBench API ─────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

interface LiveBenchScores {
  reasoning: number;
  coding: number;
  math: number;
  writing: number;
  research: number;
  execution: number;
  matched_model: string | null;
  match_type: "exact" | "alias" | "fuzzy" | "approximate" | "default";
}

async function fetchLiveBenchScores(model: string): Promise<LiveBenchScores | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/v1/livebench/scores?model=${encodeURIComponent(model)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── 图标映射 ──────────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ReactNode> = {
  Search:       <SearchIcon size={22} />,
  BrainCircuit: <BrainCircuit size={22} />,
  PenLine:      <PenLine size={22} />,
  ShieldCheck:  <ShieldCheck size={22} />,
  Sparkles:     <Sparkles size={22} />,
  Zap:          <Zap size={22} />,
  BookOpen:     <BookOpen size={22} />,
  Globe:        <Globe size={22} />,
  Code2:        <Code2 size={22} />,
};

const TOOL_ICON: Record<string, React.ReactNode> = {
  WebSearch:  <Globe size={13} />,
  文档阅读:   <FileText size={13} />,
  数据提取:   <Database size={13} />,
  代码执行:   <Code2 size={13} />,
  任务规划:   <ChevronRight size={13} />,
};

// ── Lv 进度条颜色（等级越高越亮）────────────────────────────────────────────
function getLevelGradient(level: number): string {
  if (level <= 3)  return "linear-gradient(90deg, #6b7280, #9ca3af)";
  if (level <= 6)  return "linear-gradient(90deg, #3b82f6, #60a5fa)";
  if (level <= 10) return "linear-gradient(90deg, #8b5cf6, #a78bfa)";
  if (level <= 15) return "linear-gradient(90deg, #f59e0b, #fbbf24)";
  return "linear-gradient(90deg, #ef4444, #f97316, #fbbf24)";
}

function getLevelColor(level: number): string {
  if (level <= 3)  return "#9ca3af";
  if (level <= 6)  return "#60a5fa";
  if (level <= 10) return "#a78bfa";
  if (level <= 15) return "#fbbf24";
  return "#f97316";
}

// ── 雷达图（纯 SVG，无依赖）──────────────────────────────────────────────────
function RadarChart({ scores }: { scores: AgentSkillScores }) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 75;
  const labels = ["调研力", "推理力", "代码力", "执行速", "写作力", "数学力"];
  const values = [
    scores.research, scores.reasoning, scores.coding,
    scores.execution, scores.writing, scores.math,
  ];
  const n = labels.length;

  // 计算各顶点坐标
  const angleOf = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i: number, radius: number) => ({
    x: cx + radius * Math.cos(angleOf(i)),
    y: cy + radius * Math.sin(angleOf(i)),
  });

  // 背景网格（3层）
  const gridLevels = [0.33, 0.66, 1];
  const gridPaths = gridLevels.map((ratio) => {
    const pts = Array.from({ length: n }, (_, i) => pt(i, r * ratio));
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";
  });

  // 数据多边形
  const dataPts = values.map((v, i) => pt(i, (v / 100) * r));
  const dataPath = dataPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible" }}>
      {/* 背景网格 */}
      {gridPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      ))}
      {/* 轴线 */}
      {Array.from({ length: n }, (_, i) => {
        const p = pt(i, r);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />;
      })}
      {/* 数据区域 */}
      <path d={dataPath} fill="rgba(99,102,241,0.25)" stroke="#6366f1" strokeWidth={1.5} />
      {/* 数据点 */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#818cf8" />
      ))}
      {/* 标签 */}
      {labels.map((label, i) => {
        const p = pt(i, r + 18);
        return (
          <text
            key={i} x={p.x} y={p.y}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={10} fill="rgba(255,255,255,0.5)"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

// ── 筛选下拉 ──────────────────────────────────────────────────────────────────
function FilterDropdown({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = value !== label;
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "6px 10px",
          backgroundColor: isActive ? "rgba(59,130,246,0.12)" : "var(--card-bg)",
          border: `1px solid ${isActive ? "var(--accent-blue)" : "var(--border-color)"}`,
          borderRadius: "8px",
          color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
          fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap", outline: "none",
        }}
      >
        <span>{isActive ? value : label}</span>
        <ChevronDown size={13} style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20,
            backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)",
            borderRadius: "10px", padding: "4px", minWidth: "140px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}>
            {[label, ...options].map(opt => (
              <button key={opt} onClick={() => { onChange(opt === label ? label : opt); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", textAlign: "left", padding: "7px 10px",
                  borderRadius: "6px", border: "none",
                  backgroundColor: value === opt ? "var(--sidebar-active)" : "transparent",
                  color: value === opt ? "var(--accent-blue)" : "var(--text-primary)",
                  fontSize: "13px", cursor: "pointer", outline: "none",
                }}
              >
                <span>{opt}</span>
                {value === opt && <Check size={12} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 工具栏图标按钮 ────────────────────────────────────────────────────────────
function ToolBtn({ children, title, active, onClick }: {
  children: React.ReactNode; title?: string; active?: boolean; onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "34px", height: "34px", borderRadius: "8px",
        border: active ? "1px solid var(--accent-blue)" : "1px solid transparent",
        backgroundColor: active ? "rgba(59,130,246,0.15)" : hovered ? "var(--sidebar-hover)" : "transparent",
        color: active ? "var(--accent-blue)" : hovered ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer", outline: "none", flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── 删除确认 Dialog ───────────────────────────────────────────────────────────
function DeleteConfirmDialog({ agentName, onConfirm, onCancel }: {
  agentName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      backgroundColor: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onCancel}>
      <div style={{
        width: "360px",
        backgroundColor: "#1a1d23",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "14px", overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <div style={{
            width: "34px", height: "34px", borderRadius: "10px",
            backgroundColor: "rgba(239,68,68,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Trash2 size={16} style={{ color: "#ef4444" }} />
          </div>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9" }}>删除 Agent</div>
            <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>此操作不可撤销</div>
          </div>
        </div>
        {/* 内容 */}
        <div style={{ padding: "16px 20px 20px" }}>
          <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7, margin: "0 0 18px" }}>
            确定要删除 Agent{" "}
            <span style={{ color: "#f1f5f9", fontWeight: 600 }}>「{agentName}」</span>
            {" "}吗？删除后该 Agent 的所有配置和成长数据将永久丢失。
          </p>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={onCancel} style={{
              padding: "7px 16px", borderRadius: "8px", fontSize: "13px",
              border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "transparent",
              color: "#94a3b8", cursor: "pointer", outline: "none",
            }}>
              取消
            </button>
            <button onClick={onConfirm} style={{
              padding: "7px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
              border: "none", backgroundColor: "#ef4444",
              color: "#fff", cursor: "pointer", outline: "none",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#dc2626"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#ef4444"; }}
            >
              确认删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent 卡片 ────────────────────────────────────────────────────────────────
function AgentCard({ agent, selected, onClick, onDelete }: {
  agent: AgentRow; selected: boolean; onClick: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const lvPct = Math.min(100, (agent.level / 20) * 100);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "16px",
        borderRadius: "14px",
        border: `1px solid ${selected ? "var(--accent-blue)" : hovered ? "rgba(255,255,255,0.12)" : "var(--border-subtle)"}`,
        backgroundColor: selected ? "rgba(59,130,246,0.08)" : hovered ? "var(--bg-secondary)" : "var(--card-bg)",
        cursor: "pointer",
        transition: "all 0.15s ease",
        display: "flex", flexDirection: "column", gap: "12px",
        position: "relative",
      }}
    >
      {/* 删除按钮（hover 时显示） */}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="删除 Agent"
          style={{
            position: "absolute", top: "10px", right: "10px",
            width: "26px", height: "26px", borderRadius: "7px",
            border: "1px solid rgba(239,68,68,0.3)",
            backgroundColor: "rgba(239,68,68,0.1)",
            color: "#ef4444", cursor: "pointer", outline: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s",
            zIndex: 1,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(239,68,68,0.25)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.6)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(239,68,68,0.1)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.3)";
          }}
        >
          <Trash2 size={12} />
        </button>
      )}

      {/* 头部：图标 + 名称 + 模型/状态 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div style={{
          width: "48px", height: "48px", borderRadius: "12px",
          backgroundColor: agent.iconColor,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "rgba(255,255,255,0.9)", flexShrink: 0,
        }}>
          {ICON_MAP[agent.iconName] ?? <Sparkles size={22} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
            {agent.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{agent.model}</span>
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#22c55e", flexShrink: 0 }} />
            <span style={{ fontSize: "12px", color: "#22c55e" }}>在线</span>
          </div>
        </div>
      </div>

      {/* 能力标签 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {agent.tags.slice(0, 3).map((tag, i) => {
          const colors = [
            { bg: "rgba(99,102,241,0.15)", text: "#818cf8" },
            { bg: "rgba(34,197,94,0.15)",  text: "#4ade80" },
            { bg: "rgba(168,85,247,0.15)", text: "#c084fc" },
          ];
          const c = colors[i % colors.length];
          return (
            <span key={tag} style={{
              padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 500,
              backgroundColor: c.bg, color: c.text,
            }}>
              {tag}
            </span>
          );
        })}
      </div>

      {/* Lv 进度条 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Lv.</span>
          <span style={{ fontSize: "12px", fontWeight: 700, color: getLevelColor(agent.level) }}>
            {agent.level}
          </span>
        </div>
        <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${lvPct}%`,
            background: getLevelGradient(agent.level),
            borderRadius: "2px",
            transition: "width 0.4s ease",
          }} />
        </div>
      </div>

      {/* 三项统计 */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {[
          { value: agent.taskCount, label: "完成任务" },
          { value: `${agent.accuracy}%`, label: "准确度" },
          { value: agent.teamCount, label: "协作次数" },
        ].map(({ value, label }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>
              {value}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 详情面板 ──────────────────────────────────────────────────────────────────
type DetailTab = "identity" | "ability" | "record" | "knowledge" | "memory";

function DetailPanel({
  agent,
  onClose,
  onUpdate,
}: {
  agent: AgentRow;
  onClose: () => void;
  onUpdate: (updated: AgentRow) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("identity");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 编辑草稿
  const [draft, setDraft] = useState({
    name:        agent.name,
    role:        agent.role,
    workStyle:   agent.workStyle,
    systemPrompt: agent.systemPrompt,
    tags:        agent.tags.join(", "),
    tools:       agent.tools.join(", "),
  });

  // agent 切换时重置草稿
  useEffect(() => {
    setDraft({
      name:        agent.name,
      role:        agent.role,
      workStyle:   agent.workStyle,
      systemPrompt: agent.systemPrompt,
      tags:        agent.tags.join(", "),
      tools:       agent.tools.join(", "),
    });
    setEditing(false);
  }, [agent.id]);

  const setD = (k: string, v: string) => setDraft(d => ({ ...d, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    const updated: AgentRow = {
      ...agent,
      name:        draft.name.trim() || agent.name,
      role:        draft.role.trim() || agent.role,
      workStyle:   draft.workStyle,
      systemPrompt: draft.systemPrompt.trim(),
      tags:        draft.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean),
      tools:       draft.tools.split(/[,，]/).map(t => t.trim()).filter(Boolean),
      updatedAt:   Date.now(),
    };
    await agentRepo.update(updated.id, updated);
    setSaving(false);
    setEditing(false);
    onUpdate(updated);
  };

  const handleCancel = () => {
    setDraft({
      name:        agent.name,
      role:        agent.role,
      workStyle:   agent.workStyle,
      systemPrompt: agent.systemPrompt,
      tags:        agent.tags.join(", "),
      tools:       agent.tools.join(", "),
    });
    setEditing(false);
  };

  const tabs: { key: DetailTab; label: string }[] = [
    { key: "identity",   label: "身份" },
    { key: "ability",    label: "能力" },
    { key: "record",     label: "战绩" },
    { key: "knowledge",  label: "知识库" },
    { key: "memory",     label: "记忆" },
  ];

  return (
    <div style={{
      width: "380px", flexShrink: 0,
      borderLeft: "1px solid var(--border-subtle)",
      backgroundColor: "var(--bg-secondary)",
      display: "flex", flexDirection: "column",
      height: "100%", overflow: "hidden",
    }}>
      {/* 头部 */}
      <div style={{ padding: "20px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "16px" }}>
          <div style={{
            width: "56px", height: "56px", borderRadius: "14px",
            backgroundColor: agent.iconColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.9)", flexShrink: 0,
          }}>
            {ICON_MAP[agent.iconName] ?? <Sparkles size={26} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <input
                value={draft.name}
                onChange={e => setD("name", e.target.value)}
                style={{
                  width: "100%", fontSize: "16px", fontWeight: 700,
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(99,102,241,0.5)",
                  borderRadius: "6px", color: "var(--text-primary)",
                  padding: "3px 7px", outline: "none", marginBottom: "4px",
                  boxSizing: "border-box",
                }}
              />
            ) : (
              <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>
                {agent.name}
              </div>
            )}
            <div style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
              {editing ? (
                <input
                  value={draft.role}
                  onChange={e => setD("role", e.target.value)}
                  placeholder="角色描述"
                  style={{
                    width: "100%", fontSize: "12px",
                    backgroundColor: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "5px", color: "var(--text-secondary)",
                    padding: "2px 6px", outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <>
                  {agent.role} ·{" "}
                  <span style={{ color: "var(--accent-blue)" }}>{agent.workStyle}</span>
                </>
              )}
            </div>
          </div>
          {/* 编辑 / 关闭按钮 */}
          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
            {tab === "identity" && !editing && tab !== "memory" && (
              <button
                onClick={() => setEditing(true)}
                title="编辑"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "28px", height: "28px", borderRadius: "8px",
                  border: "none", backgroundColor: "var(--sidebar-hover)",
                  color: "var(--text-secondary)", cursor: "pointer", outline: "none",
                }}
              >
                <Pencil size={13} />
              </button>
            )}
            <button onClick={onClose} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "8px",
              border: "none", backgroundColor: "var(--sidebar-hover)",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tab 导航 */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: "7px 0", border: "none", background: "none",
              fontSize: "12px", fontWeight: tab === t.key ? 600 : 400,
              color: tab === t.key ? "var(--text-primary)" : "var(--text-muted)",
              cursor: "pointer", outline: "none",
              borderBottom: `2px solid ${tab === t.key ? "var(--accent-blue)" : "transparent"}`,
              marginBottom: "-1px", transition: "all 0.15s",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

        {/* ── 身份 Tab ── */}
        {tab === "identity" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Section title="基础配置">
              <InfoRow label="模型" value={agent.model} />
              {editing ? (
                <div style={{ padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "6px" }}>工作风格</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {["严谨型", "分析型", "创意型", "执行型", "协作型"].map(s => (
                      <button key={s} onClick={() => setD("workStyle", s)} style={{
                        padding: "4px 10px", borderRadius: "7px", fontSize: "12px",
                        border: `1px solid ${draft.workStyle === s ? "var(--accent-blue)" : "rgba(255,255,255,0.1)"}`,
                        backgroundColor: draft.workStyle === s ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                        color: draft.workStyle === s ? "var(--accent-blue)" : "var(--text-muted)",
                        cursor: "pointer", outline: "none",
                      }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <InfoRow label="工作风格" value={agent.workStyle} highlight />
              )}
              <InfoRow label="权限等级" value={`Lv.${agent.permissionLevel} ${["", "基础", "标准", "高权限", "管理员", "超级"][agent.permissionLevel] ?? ""}`} />
            </Section>
            <Section title="SYSTEM PROMPT">
              {editing ? (
                <textarea
                  rows={5}
                  value={draft.systemPrompt}
                  onChange={e => setD("systemPrompt", e.target.value)}
                  placeholder="描述 Agent 的角色、能力和行为规范..."
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "8px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(99,102,241,0.4)",
                    fontSize: "12px", color: "var(--text-primary)",
                    lineHeight: 1.7, resize: "vertical", outline: "none",
                    fontFamily: "inherit", boxSizing: "border-box",
                  }}
                />
              ) : (
                <div style={{
                  padding: "10px 12px", borderRadius: "8px",
                  backgroundColor: "var(--bg-primary)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "12px", color: "var(--text-secondary)",
                  lineHeight: 1.7, whiteSpace: "pre-wrap",
                }}>
                  {agent.systemPrompt || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>未设置</span>}
                </div>
              )}
            </Section>
            <Section title="能力标签">
              {editing ? (
                <input
                  value={draft.tags}
                  onChange={e => setD("tags", e.target.value)}
                  placeholder="如：调研专家, 长文写作（逗号分隔）"
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: "8px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontSize: "12px", color: "var(--text-primary)",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {agent.tags.length === 0
                    ? <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>暂无标签</span>
                    : agent.tags.map((tag, i) => {
                        const colors = [
                          { bg: "rgba(99,102,241,0.15)", text: "#818cf8" },
                          { bg: "rgba(34,197,94,0.15)",  text: "#4ade80" },
                          { bg: "rgba(168,85,247,0.15)", text: "#c084fc" },
                        ];
                        const c = colors[i % colors.length];
                        return (
                          <span key={tag} style={{
                            padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 500,
                            backgroundColor: c.bg, color: c.text,
                          }}>
                            {tag}
                          </span>
                        );
                      })
                  }
                </div>
              )}
            </Section>
            <Section title="已装载工具">
              {editing ? (
                <input
                  value={draft.tools}
                  onChange={e => setD("tools", e.target.value)}
                  placeholder="如：WebSearch, 文档阅读（逗号分隔）"
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: "8px",
                    backgroundColor: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    fontSize: "12px", color: "var(--text-primary)",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {agent.tools.length === 0
                    ? <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>暂无工具</span>
                    : agent.tools.map(tool => (
                        <span key={tool} style={{
                          display: "flex", alignItems: "center", gap: "5px",
                          padding: "4px 10px", borderRadius: "8px", fontSize: "12px",
                          backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)",
                          color: "var(--text-secondary)",
                        }}>
                          {TOOL_ICON[tool] ?? <Zap size={13} />}
                          {tool}
                        </span>
                      ))
                  }
                </div>
              )}
            </Section>

            {/* 编辑模式底部按钮 */}
            {editing && (
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", paddingTop: "4px" }}>
                <button onClick={handleCancel} style={{
                  padding: "7px 14px", borderRadius: "8px", fontSize: "13px",
                  border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "transparent",
                  color: "var(--text-muted)", cursor: "pointer", outline: "none",
                }}>
                  取消
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "7px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                  border: "none", backgroundColor: saving ? "rgba(99,102,241,0.5)" : "#6366f1",
                  color: "#fff", cursor: saving ? "not-allowed" : "pointer", outline: "none",
                }}>
                  {saving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={13} />}
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 能力 Tab ── */}
        {tab === "ability" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Section title="能力雷达">
              <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
                <RadarChart scores={agent.skillScores} />
              </div>
            </Section>
            <Section title="能力标签">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {agent.tags.map((tag, i) => {
                  const colors = [
                    { bg: "rgba(99,102,241,0.15)", text: "#818cf8" },
                    { bg: "rgba(34,197,94,0.15)",  text: "#4ade80" },
                    { bg: "rgba(168,85,247,0.15)", text: "#c084fc" },
                  ];
                  const c = colors[i % colors.length];
                  return (
                    <span key={tag} style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 500,
                      backgroundColor: c.bg, color: c.text,
                    }}>
                      {tag}
                    </span>
                  );
                })}
              </div>
            </Section>
            <Section title="各维度得分">
              {(Object.entries(agent.skillScores) as [keyof AgentSkillScores, number][]).map(([key, val]) => {
                const nameMap: Record<keyof AgentSkillScores, string> = {
                  reasoning: "推理力", coding: "代码力", research: "调研力",
                  writing: "写作力", math: "数学力", execution: "执行速",
                };
                const pct = Math.min(100, Math.max(0, val));
                return (
                  <div key={key} style={{ marginBottom: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{nameMap[key]}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{val.toFixed ? val.toFixed(1) : val}</span>
                    </div>
                    <div style={{ height: "3px", borderRadius: "2px", backgroundColor: "rgba(255,255,255,0.08)" }}>
                      <div style={{
                        height: "100%", width: `${pct}%`,
                        background: "linear-gradient(90deg, #6366f1, #818cf8)",
                        borderRadius: "2px",
                      }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>评测数据来源：</span>
                <a href="https://livebench.ai" target="_blank" rel="noreferrer"
                  style={{ fontSize: "10px", color: "var(--accent-blue)", textDecoration: "none", display: "flex", alignItems: "center", gap: "2px" }}
                >
                  livebench.ai <ExternalLink size={9} />
                </a>
              </div>
            </Section>
          </div>
        )}

        {/* ── 战绩 Tab ── */}
        {tab === "record" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <Section title="成长轨迹">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {[
                  { label: "当前等级", value: `Lv.${agent.level}`, color: getLevelColor(agent.level) },
                  { label: "完成任务", value: `${agent.taskCount} 次` },
                  { label: "准确度",   value: `${agent.accuracy}%` },
                  { label: "协作次数", value: `${agent.teamCount} 次` },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    padding: "12px", borderRadius: "10px",
                    backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: color ?? "var(--text-primary)", marginBottom: "4px" }}>
                      {value}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{label}</div>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="等级进度">
              <div style={{ marginBottom: "6px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Lv.{agent.level}</span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Lv.{Math.min(20, agent.level + 1)}</span>
              </div>
              <div style={{ height: "6px", borderRadius: "3px", backgroundColor: "rgba(255,255,255,0.08)" }}>
                <div style={{
                  height: "100%",
                  width: `${((agent.taskCount % 5) / 5) * 100}%`,
                  background: getLevelGradient(agent.level),
                  borderRadius: "3px", transition: "width 0.4s ease",
                }} />
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
                距下一级还需 {5 - (agent.taskCount % 5)} 次任务
              </div>
            </Section>
            <Section title="创建时间">
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {new Date(agent.createdAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </Section>
          </div>
        )}

        {/* ── 知识库 Tab ── */}
        {tab === "knowledge" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Section title="已关联文档">
              {agent.knowledgeDocs.length === 0 ? (
                <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "12px 0" }}>
                  暂无关联文档
                </div>
              ) : (
                agent.knowledgeDocs.map((doc, i) => (
                  <a key={i} href={doc.url} target="_blank" rel="noreferrer" style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "10px 12px", borderRadius: "8px",
                    backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)",
                    textDecoration: "none", color: "var(--text-primary)", fontSize: "13px",
                    marginBottom: "6px",
                  }}>
                    <FileText size={14} style={{ color: "var(--accent-blue)", flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {doc.name}
                    </span>
                    <ChevronRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  </a>
                ))
              )}
            </Section>
            <button style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              padding: "10px", borderRadius: "8px",
              border: "1px dashed var(--border-color)",
              backgroundColor: "transparent", color: "var(--text-muted)",
              fontSize: "13px", cursor: "pointer", outline: "none",
            }}>
              <Plus size={14} /> 添加文档
            </button>
          </div>
        )}

        {/* ── 记忆 Tab ── */}
        {tab === "memory" && <MemoryTabContent />}
      </div>
    </div>
  );
}

// ── 记忆 Tab 内容 ─────────────────────────────────────────────────────────────

type MemoryType = "soul" | "memory" | "user" | "common";

interface MemGroupConfig {
  type: MemoryType;
  label: string;
  desc: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
}

const MEM_GROUPS: MemGroupConfig[] = [
  {
    type: "common",
    label: "公共记忆",
    desc: "对外可见，对方 Agent 起草消息时会自动注入",
    color: "#10b981",
    bgColor: "rgba(16,185,129,0.08)",
    borderColor: "rgba(16,185,129,0.25)",
    icon: <Globe size={12} />,
  },
  {
    type: "soul",
    label: "灵魂设定",
    desc: "Agent 的个性、价值观与核心身份",
    color: "#a78bfa",
    bgColor: "rgba(167,139,250,0.08)",
    borderColor: "rgba(167,139,250,0.25)",
    icon: <Sparkles size={12} />,
  },
  {
    type: "memory",
    label: "工作记忆",
    desc: "Agent 积累的经验、偏好与工作方式",
    color: "#60a5fa",
    bgColor: "rgba(96,165,250,0.08)",
    borderColor: "rgba(96,165,250,0.25)",
    icon: <Brain size={12} />,
  },
  {
    type: "user",
    label: "用户记忆",
    desc: "关于你自己的背景、习惯与偏好",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.08)",
    borderColor: "rgba(245,158,11,0.25)",
    icon: <User size={12} />,
  },
];

function MemoryTabContent() {
  const [memories, setMemories] = useState<Record<string, AgentMemory[]>>({});
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<MemoryType, boolean>>({
    soul: false, memory: false, user: false, common: false,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<MemoryType>("common");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<MemoryType | null>(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await memoriesApi.getMyMemories();
      setMemories(data);
    } catch (e) {
      console.error("加载记忆失败:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const startEdit = (mem: AgentMemory) => {
    setEditingId(mem.id);
    setEditingType(mem.type);
    setEditTitle(mem.title || "");
    setEditContent(mem.content);
    setCreatingType(null);
  };

  const startCreate = (type: MemoryType) => {
    setCreatingType(type);
    setEditingId(null);
    setEditingType(type);
    setEditTitle("");
    setEditContent("");
    setCollapsed(prev => ({ ...prev, [type]: false }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setCreatingType(null);
    setEditTitle("");
    setEditContent("");
  };

  const handleSave = async () => {
    if (!editContent.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await memoriesApi.updateMemory(editingId, {
          title: editTitle.trim() || undefined,
          content: editContent.trim(),
        });
        setMemories(prev => {
          const group = [...(prev[editingType] || [])];
          const idx = group.findIndex(m => m.id === editingId);
          if (idx >= 0) group[idx] = updated;
          return { ...prev, [editingType]: group };
        });
      } else {
        const created = await memoriesApi.createMemory({
          type: editingType,
          title: editTitle.trim() || undefined,
          content: editContent.trim(),
        });
        setMemories(prev => ({
          ...prev,
          [editingType]: [...(prev[editingType] || []), created],
        }));
      }
      cancelEdit();
    } catch (e) {
      console.error("保存记忆失败:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (mem: AgentMemory) => {
    setDeletingId(mem.id);
    try {
      await memoriesApi.deleteMemory(mem.id);
      setMemories(prev => ({
        ...prev,
        [mem.type]: (prev[mem.type] || []).filter(m => m.id !== mem.id),
      }));
    } catch (e) {
      console.error("删除记忆失败:", e);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontSize: "13px" }}>
        加载中...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {MEM_GROUPS.map(group => {
        const items = memories[group.type] || [];
        const isCollapsed = collapsed[group.type];
        const isCreating = creatingType === group.type;

        return (
          <div key={group.type}>
            {/* 分组标题 */}
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "5px 6px", borderRadius: "6px", cursor: "pointer", userSelect: "none",
              }}
              onClick={() => setCollapsed(prev => ({ ...prev, [group.type]: !prev[group.type] }))}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-hover)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <span style={{ color: group.color }}>{group.icon}</span>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-primary)" }}>{group.label}</span>
                <span style={{
                  fontSize: "10px", padding: "1px 5px", borderRadius: "8px",
                  backgroundColor: group.bgColor, color: group.color, border: `1px solid ${group.borderColor}`,
                }}>
                  {items.length}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <button
                  onClick={e => { e.stopPropagation(); startCreate(group.type); }}
                  title={`新建${group.label}`}
                  style={{
                    width: "20px", height: "20px", borderRadius: "4px", border: "none",
                    cursor: "pointer", backgroundColor: "transparent", color: group.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = group.bgColor; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                >
                  <Plus size={11} />
                </button>
                <span style={{ color: "var(--text-muted)" }}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronUp size={12} />}
                </span>
              </div>
            </div>

            {/* 分组描述 */}
            {!isCollapsed && (
              <div style={{ fontSize: "10px", color: "var(--text-muted)", padding: "0 6px 4px", lineHeight: 1.4 }}>
                {group.desc}
              </div>
            )}

            {/* 新建表单 */}
            {!isCollapsed && isCreating && (
              <MemInlineForm
                title={editTitle} content={editContent} saving={saving}
                groupColor={group.color}
                onTitleChange={setEditTitle} onContentChange={setEditContent}
                onSave={handleSave} onCancel={cancelEdit} isNew
              />
            )}

            {/* 条目列表 */}
            {!isCollapsed && items.map(mem => {
              if (editingId === mem.id) {
                return (
                  <MemInlineForm
                    key={mem.id}
                    title={editTitle} content={editContent} saving={saving}
                    groupColor={group.color}
                    onTitleChange={setEditTitle} onContentChange={setEditContent}
                    onSave={handleSave} onCancel={cancelEdit}
                  />
                );
              }
              return (
                <MemItem
                  key={mem.id} mem={mem}
                  groupColor={group.color} groupBg={group.bgColor} groupBorder={group.borderColor}
                  isDeleting={deletingId === mem.id}
                  onEdit={() => startEdit(mem)}
                  onDelete={() => handleDelete(mem)}
                />
              );
            })}

            {/* 空状态 */}
            {!isCollapsed && items.length === 0 && !isCreating && (
              <div
                style={{
                  padding: "10px 6px", fontSize: "11px", color: "var(--text-muted)",
                  textAlign: "center", borderRadius: "6px",
                  border: `1px dashed ${group.borderColor}`, margin: "2px 0",
                  cursor: "pointer",
                }}
                onClick={() => startCreate(group.type)}
              >
                + 添加{group.label}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MemItem({
  mem, groupColor, groupBg, groupBorder, isDeleting, onEdit, onDelete,
}: {
  mem: AgentMemory; groupColor: string; groupBg: string; groupBorder: string;
  isDeleting: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const timeStr = new Date(mem.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDel(false); }}
      style={{
        padding: "8px 10px", borderRadius: "7px", marginBottom: "4px",
        border: `1px solid ${hovered ? groupBorder : "var(--border-subtle)"}`,
        backgroundColor: hovered ? groupBg : "transparent",
        transition: "all 0.15s ease",
      }}
    >
      {mem.title && (
        <div style={{ fontSize: "10px", fontWeight: 600, color: groupColor, marginBottom: "3px" }}>
          {mem.title}
        </div>
      )}
      <div style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {mem.content}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "5px" }}>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{timeStr} 更新</span>
        {hovered && (
          <div style={{ display: "flex", gap: "3px" }}>
            <button onClick={onEdit} title="编辑" style={{
              width: "20px", height: "20px", borderRadius: "4px", border: "none",
              cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = groupColor; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
            >
              <Pencil size={10} />
            </button>
            {confirmDel ? (
              <button onClick={() => { setConfirmDel(false); onDelete(); }} disabled={isDeleting} style={{
                height: "20px", padding: "0 6px", borderRadius: "4px", border: "none",
                cursor: "pointer", backgroundColor: "rgba(239,68,68,0.12)", color: "#ef4444",
                fontSize: "10px", fontWeight: 600, display: "flex", alignItems: "center", gap: "2px",
              }}>
                {isDeleting ? <Loader2 size={9} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={9} />}
                确认
              </button>
            ) : (
              <button onClick={() => setConfirmDel(true)} title="删除" style={{
                width: "20px", height: "20px", borderRadius: "4px", border: "none",
                cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MemInlineForm({
  title, content, saving, groupColor,
  onTitleChange, onContentChange, onSave, onCancel, isNew = false,
}: {
  title: string; content: string; saving: boolean; groupColor: string;
  onTitleChange: (v: string) => void; onContentChange: (v: string) => void;
  onSave: () => void; onCancel: () => void; isNew?: boolean;
}) {
  return (
    <div style={{
      padding: "8px 10px", borderRadius: "7px", marginBottom: "4px",
      border: `1px solid ${groupColor}`,
      backgroundColor: "var(--sidebar-hover)",
    }}>
      <input
        type="text" value={title} onChange={e => onTitleChange(e.target.value)}
        placeholder="标题（可选）"
        style={{
          width: "100%", padding: "3px 0", border: "none",
          borderBottom: "1px solid var(--border-subtle)",
          backgroundColor: "transparent", color: "var(--text-primary)",
          fontSize: "10px", fontWeight: 600, outline: "none", marginBottom: "6px",
          fontFamily: "inherit", boxSizing: "border-box",
        }}
      />
      <textarea
        value={content} onChange={e => onContentChange(e.target.value)}
        placeholder={isNew ? "输入记忆内容..." : "编辑内容..."}
        rows={3} autoFocus
        style={{
          width: "100%", padding: "0", border: "none",
          backgroundColor: "transparent", color: "var(--text-primary)",
          fontSize: "12px", lineHeight: 1.5, outline: "none",
          resize: "vertical", fontFamily: "inherit", minHeight: "50px",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "5px", marginTop: "6px" }}>
        <button onClick={onCancel} style={{
          padding: "3px 8px", borderRadius: "5px", border: "1px solid var(--border-color)",
          cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)", fontSize: "11px",
        }}>
          取消
        </button>
        <button onClick={onSave} disabled={!content.trim() || saving} style={{
          padding: "3px 8px", borderRadius: "5px", border: "none",
          cursor: content.trim() && !saving ? "pointer" : "not-allowed",
          backgroundColor: content.trim() && !saving ? groupColor : "var(--border-color)",
          color: "#fff", fontSize: "11px", fontWeight: 600,
          display: "flex", alignItems: "center", gap: "3px",
        }}>
          {saving ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={10} />}
          {isNew ? "添加" : "保存"}
        </button>
      </div>
    </div>
  );
}

// ── 辅助组件 ──────────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: "13px", fontWeight: 500, color: highlight ? "var(--accent-blue)" : "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

// ── 新建 Agent 表单 ───────────────────────────────────────────────────────────
const ICON_OPTIONS = ["Search", "BrainCircuit", "PenLine", "ShieldCheck", "Sparkles", "Zap", "BookOpen", "Globe", "Code2"];
const COLOR_OPTIONS = ["#1e3a5f", "#2d1b4e", "#1a3d2b", "#3d2000", "#1a2a3d", "#2d1a1a", "#1a3d3d"];

const DEFAULT_SCORES: AgentSkillScores = {
  reasoning: 50, coding: 50, research: 50, writing: 50, math: 50, execution: 50,
};

// ── 模型选择器（从本地 API Key 读取可用模型）────────────────────────────────
function ModelSelector({ value, onChange }: {
  value: string;
  onChange: (keyId: string, displayLabel: string, apiName: string) => void;
}) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);

  useEffect(() => {
    apiKeyRepo.getAll().then(all => {
      setKeys(all.filter(k => k.isActive));
      setKeysLoading(false);
    });
  }, []);

  if (keysLoading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        padding: "10px 12px", borderRadius: "8px",
        border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)",
        color: "var(--text-muted)", fontSize: "13px",
      }}>
        <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
        加载中...
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "12px 14px", borderRadius: "8px",
        border: "1px dashed rgba(239,68,68,0.4)",
        backgroundColor: "rgba(239,68,68,0.05)",
      }}>
        <AlertCircle size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "2px" }}>
            未配置 API Key
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            请先前往
            <a href="/settings/apikey" style={{ color: "var(--accent-blue)", textDecoration: "none", margin: "0 3px" }}>
              设置 → API Key 管理
            </a>
            添加可用模型
          </div>
        </div>
        <a href="/settings/apikey" style={{
          display: "flex", alignItems: "center", gap: "4px",
          padding: "5px 10px", borderRadius: "6px",
          backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)",
          color: "var(--accent-blue)", fontSize: "12px", textDecoration: "none", flexShrink: 0,
        }}>
          <Key size={11} /> 去添加
        </a>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => {
        const key = keys.find(k => k.id === e.target.value);
        // displayLabel：用户自定义备注名（label），用于界面显示
        // apiName：真实模型 ID（modelName），用于 LiveBench 查询和 API 调用
        if (key) onChange(key.id, key.modelName || key.label, key.modelName ?? "");
      }}
      style={{
        width: "100%", padding: "8px 10px", borderRadius: "8px",
        border: "1px solid var(--border-color)", backgroundColor: "var(--bg-primary)",
        color: "var(--text-primary)", fontSize: "13px", outline: "none",
      }}
    >
      {keys.map(k => (
        <option key={k.id} value={k.id}>
          {k.modelName || k.label}
          {k.provider !== "custom" ? ` (${k.provider})` : ""}
        </option>
      ))}
    </select>
  );
}

function CreateAgentModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (data: Omit<AgentRow, "id" | "createdAt" | "updatedAt" | "level">) => void;
}) {
  const [form, setForm] = useState({
    name: "", role: "", workStyle: "严谨型",
    // modelKeyId: API Key 的 id；modelDisplayName: 显示名（modelName 或 label）
    modelKeyId: "", modelDisplayName: "",
    systemPrompt: "", permissionLevel: 2,
    iconName: "Sparkles", iconColor: "#1e3a5f",
    tags: "", tools: "WebSearch",
  });

  // LiveBench 分数状态
  const [lbScores, setLbScores] = useState<AgentSkillScores | null>(null);
  const [lbMatched, setLbMatched] = useState<string | null>(null);
  const [lbMatchType, setLbMatchType] = useState<LiveBenchScores["match_type"] | null>(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState(false);

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  // 查询 LiveBench 数据
  const queryLiveBench = useCallback(async (modelName: string) => {
    if (!modelName) return;
    setLbScores(null);
    setLbMatched(null);
    setLbMatchType(null);
    setLbError(false);
    setLbLoading(true);
    const data = await fetchLiveBenchScores(modelName);
    setLbLoading(false);
    if (data) {
      setLbScores({
        reasoning: data.reasoning,
        coding:    data.coding,
        math:      data.math,
        writing:   data.writing,
        research:  data.research,
        execution: data.execution,
      });
      setLbMatched(data.matched_model);
      setLbMatchType(data.match_type);
    } else {
      setLbError(true);
    }
  }, []);

  // 选择模型后自动拉取 LiveBench 数据
  // apiName 是真实模型 ID（如 claude-sonnet-4-6-20250514），优先用于 LiveBench 查询
  // displayName 是用户自定义 label，仅用于显示
  const handleModelChange = (keyId: string, displayName: string, apiName: string) => {
    setForm(f => ({ ...f, modelKeyId: keyId, modelDisplayName: displayName }));
    queryLiveBench(apiName || displayName);
  };

  // 初始加载：读取第一个可用 Key 并查询
  useEffect(() => {
    apiKeyRepo.getAll().then(all => {
      const active = all.filter(k => k.isActive);
      if (active.length > 0) {
        const first = active[0];
        const displayName = first.modelName || first.label;
        // 优先用 modelName（真实 API 名）查 LiveBench，fallback 到 label
        const apiName = first.modelName ?? first.label;
        setForm(f => ({ ...f, modelKeyId: first.id, modelDisplayName: displayName }));
        queryLiveBench(apiName);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    onCreate({
      name: form.name.trim(),
      role: form.role.trim() || "通用 Agent",
      workStyle: form.workStyle,
      model: form.modelDisplayName || "未配置模型",
      systemPrompt: form.systemPrompt.trim(),
      permissionLevel: form.permissionLevel,
      iconName: form.iconName,
      iconColor: form.iconColor,
      tags: form.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean),
      tools: form.tools.split(/[,，]/).map(t => t.trim()).filter(Boolean),
      skillScores: lbScores ?? DEFAULT_SCORES,
      taskCount: 0, accuracy: 0, teamCount: 0,
      knowledgeDocs: [],
      status: "online",
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      // 加深遮罩，确保 Modal 清晰可见
      backgroundColor: "rgba(0,0,0,0.75)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        width: "500px", maxHeight: "85vh",
        // 使用纯色背景，不透明
        backgroundColor: "#1a1d23",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "16px", overflow: "hidden",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
      }} onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          backgroundColor: "#1e2128",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} style={{ color: "var(--accent-blue)" }} />
            <span style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9" }}>新建 Agent</span>
          </div>
          <button onClick={onClose} style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "28px", height: "28px", borderRadius: "8px",
            border: "none", backgroundColor: "rgba(255,255,255,0.06)",
            color: "#94a3b8", cursor: "pointer", outline: "none",
          }}>
            <X size={14} />
          </button>
        </div>

        {/* 表单内容 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 图标 + 颜色选择 */}
            <div>
              <Label dark>图标 & 背景色</Label>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                {ICON_OPTIONS.map(name => (
                  <button key={name} onClick={() => set("iconName", name)} style={{
                    width: "36px", height: "36px", borderRadius: "8px",
                    border: `1px solid ${form.iconName === name ? "#3b82f6" : "rgba(255,255,255,0.1)"}`,
                    backgroundColor: form.iconName === name ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.04)",
                    color: form.iconName === name ? "#60a5fa" : "#64748b",
                    cursor: "pointer", outline: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}>
                    {ICON_MAP[name]}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {COLOR_OPTIONS.map(c => (
                  <button key={c} onClick={() => set("iconColor", c)} style={{
                    width: "26px", height: "26px", borderRadius: "6px",
                    backgroundColor: c,
                    border: form.iconColor === c ? "2px solid #3b82f6" : "2px solid transparent",
                    outline: form.iconColor === c ? "1px solid rgba(59,130,246,0.4)" : "none",
                    cursor: "pointer",
                  }} />
                ))}
              </div>
            </div>

            <FormField dark label="Agent 名称 *" placeholder="如：调研员 Alpha" value={form.name} onChange={v => set("name", v)} />
            <FormField dark label="角色描述" placeholder="如：深度调研 · 信息聚合专家" value={form.role} onChange={v => set("role", v)} />

            {/* 模型选择（从 API Key 读取） */}
            <div>
              <Label dark>绑定模型</Label>
              <ModelSelector value={form.modelKeyId} onChange={handleModelChange} />
            </div>

            {/* LiveBench 能力预览 */}
            {(lbLoading || lbScores || lbError) && (() => {
              // match_type → 显示配置
              const matchMeta: Record<string, { label: string; color: string; tip: string }> = {
                exact:       { label: "精确匹配", color: "#22c55e", tip: "" },
                alias:       { label: "别名匹配", color: "#22c55e", tip: "" },
                fuzzy:       { label: "模糊匹配", color: "#f59e0b", tip: "数据来自相近版本，仅供参考" },
                approximate: { label: "近似匹配", color: "#f59e0b", tip: "未找到完全一致的版本，已去除后缀近似匹配" },
                default:     { label: "默认分数", color: "#64748b", tip: "未找到该模型的评测数据，所有维度使用 50 分" },
              };
              const meta = lbMatchType ? matchMeta[lbMatchType] : null;
              const isApproxOrDefault = lbMatchType === "approximate" || lbMatchType === "default";

              return (
                <div style={{
                  borderRadius: "10px",
                  border: `1px solid ${isApproxOrDefault ? "rgba(245,158,11,0.25)" : lbScores ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.08)"}`,
                  backgroundColor: isApproxOrDefault ? "rgba(245,158,11,0.05)" : lbScores ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.03)",
                  padding: "12px 14px",
                  transition: "all 0.2s ease",
                }}>
                  {/* 标题行 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        LiveBench 评测数据
                      </span>
                      {lbLoading && <Loader2 size={11} style={{ color: "#64748b", animation: "spin 1s linear infinite" }} />}
                    </div>
                    {/* 匹配类型标签 */}
                    {meta && !lbLoading && (
                      <span style={{
                        fontSize: "10px", fontWeight: 500,
                        color: meta.color,
                        backgroundColor: `${meta.color}18`,
                        border: `1px solid ${meta.color}40`,
                        borderRadius: "4px", padding: "1px 6px",
                        flexShrink: 0,
                      }}>
                        {meta.label}
                      </span>
                    )}
                  </div>

                  {/* 匹配到的模型名 + tip */}
                  {!lbLoading && lbMatched && (
                    <div style={{ fontSize: "10px", color: "#475569", marginBottom: "8px", fontStyle: "italic",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      → {lbMatched}
                      {meta?.tip && <span style={{ color: "#f59e0b", marginLeft: "6px", fontStyle: "normal" }}>· {meta.tip}</span>}
                    </div>
                  )}
                  {!lbLoading && lbMatchType === "default" && meta?.tip && (
                    <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "8px" }}>
                      {meta.tip}
                    </div>
                  )}

                  {lbLoading ? (
                    <div style={{ fontSize: "12px", color: "#64748b", padding: "4px 0" }}>
                      正在查询 LiveBench 数据...
                    </div>
                  ) : lbScores ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                      {(Object.entries(lbScores) as [keyof AgentSkillScores, number][]).map(([key, val]) => {
                        const nameMap: Record<keyof AgentSkillScores, string> = {
                          reasoning: "推理力", coding: "代码力", research: "调研力",
                          writing: "写作力", math: "数学力", execution: "执行速",
                        };
                        const pct = Math.min(100, Math.max(0, val));
                        const barColor = isApproxOrDefault
                          ? "linear-gradient(90deg, #78716c, #a8a29e)"
                          : "linear-gradient(90deg, #6366f1, #818cf8)";
                        const valColor = isApproxOrDefault ? "#a8a29e" : "#818cf8";
                        return (
                          <div key={key}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                              <span style={{ fontSize: "11px", color: "#94a3b8" }}>{nameMap[key]}</span>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: valColor }}>{val.toFixed(1)}</span>
                            </div>
                            <div style={{ height: "3px", borderRadius: "2px", backgroundColor: "rgba(255,255,255,0.06)" }}>
                              <div style={{
                                height: "100%", width: `${pct}%`,
                                background: barColor,
                                borderRadius: "2px", transition: "width 0.4s ease",
                              }} />
                            </div>
                          </div>
                        );
                      })}
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px" }}>
                        <span style={{ fontSize: "10px", color: "#475569" }}>数据来源：</span>
                        <a href="https://livebench.ai" target="_blank" rel="noreferrer"
                          style={{ fontSize: "10px", color: "#60a5fa", textDecoration: "none", display: "flex", alignItems: "center", gap: "2px" }}
                          onClick={e => e.stopPropagation()}
                        >
                          livebench.ai <ExternalLink size={9} />
                        </a>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}

            {/* 工作风格 */}
            <div>
              <Label dark>工作风格</Label>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {["严谨型", "分析型", "创意型", "执行型", "协作型"].map(s => (
                  <button key={s} onClick={() => set("workStyle", s)} style={{
                    padding: "5px 12px", borderRadius: "8px", fontSize: "12px",
                    border: `1px solid ${form.workStyle === s ? "#3b82f6" : "rgba(255,255,255,0.1)"}`,
                    backgroundColor: form.workStyle === s ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                    color: form.workStyle === s ? "#60a5fa" : "#94a3b8",
                    cursor: "pointer", outline: "none", transition: "all 0.15s",
                  }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <FormField dark label="System Prompt" placeholder="描述 Agent 的角色、能力和行为规范..." value={form.systemPrompt} onChange={v => set("systemPrompt", v)} multiline />
            <FormField dark label="能力标签（逗号分隔）" placeholder="如：调研专家, 长文写作" value={form.tags} onChange={v => set("tags", v)} />
            <FormField dark label="装载工具（逗号分隔）" placeholder="如：WebSearch, 文档阅读" value={form.tools} onChange={v => set("tools", v)} />
          </div>
        </div>

        {/* 底部按钮 */}
        <div style={{
          display: "flex", gap: "8px", justifyContent: "flex-end",
          padding: "14px 20px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          backgroundColor: "#1e2128",
          flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: "8px", fontSize: "13px",
            border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "transparent",
            color: "#94a3b8", cursor: "pointer", outline: "none",
          }}>
            取消
          </button>
          <button onClick={handleSubmit} disabled={!form.name.trim()} style={{
            padding: "8px 20px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
            border: "none",
            backgroundColor: form.name.trim() ? "#3b82f6" : "rgba(255,255,255,0.06)",
            color: form.name.trim() ? "#fff" : "#475569",
            cursor: form.name.trim() ? "pointer" : "not-allowed", outline: "none",
            transition: "all 0.15s",
          }}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div style={{
      fontSize: "11px", fontWeight: 600, marginBottom: "6px",
      textTransform: "uppercase", letterSpacing: "0.06em",
      color: dark ? "#64748b" : "var(--text-muted)",
    }}>
      {children}
    </div>
  );
}

function FormField({ label, placeholder, value, onChange, multiline, dark }: {
  label: string; placeholder?: string; value: string;
  onChange: (v: string) => void; multiline?: boolean; dark?: boolean;
}) {
  const style: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: "8px",
    border: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid var(--border-color)",
    backgroundColor: dark ? "rgba(255,255,255,0.05)" : "var(--bg-primary)",
    color: dark ? "#e2e8f0" : "var(--text-primary)",
    fontSize: "13px", outline: "none",
    fontFamily: "inherit", boxSizing: "border-box",
    resize: multiline ? "vertical" : undefined,
  };
  return (
    <div>
      <Label dark={dark}>{label}</Label>
      {multiline
        ? <textarea rows={3} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={style} />
        : <input type="text" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={style} />
      }
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function AgentPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filterModel, setFilterModel] = useState("全部模型");
  const [filterRole, setFilterRole] = useState("全部角色");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  // 删除确认：存储待删除的 Agent id 和名称
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const loaded = useRef(false);

  const loadAgents = useCallback(async () => {
    const list = await agentRepo.list();
    setAgents(list);
    setLoading(false);
  }, []);

  // 首次加载
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadAgents();
  }, [loadAgents]);

  const handleCreate = async (data: Omit<AgentRow, "id" | "createdAt" | "updatedAt" | "level">) => {
    const created = await agentRepo.create(data);
    setAgents(prev => [created, ...prev]);
    setShowCreate(false);
    setSelectedId(created.id);
  };

  // 删除 Agent
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await agentRepo.delete(deleteTarget.id);
    setAgents(prev => prev.filter(a => a.id !== deleteTarget.id));
    // 若删除的是当前选中的，关闭详情面板
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteTarget(null);
  };

  // 过滤
  const filtered = agents.filter(a => {
    const q = search.toLowerCase();
    const matchSearch = !q || a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q) || a.tags.some(t => t.toLowerCase().includes(q));
    const matchModel = filterModel === "全部模型" || a.model.toLowerCase().includes(filterModel.toLowerCase());
    const matchRole  = filterRole  === "全部角色"  || a.tags.some(t => t.includes(filterRole)) || a.role.includes(filterRole);
    return matchSearch && matchModel && matchRole;
  });

  const selectedAgent = agents.find(a => a.id === selectedId) ?? null;

  // 可用模型列表（从已有 Agent 中提取）
  const modelOptions = [...new Set(agents.map(a => a.model))];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", backgroundColor: "var(--background)" }}>

      {/* ── 顶部工具栏 ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px",
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: "var(--topbar-bg)",
        flexShrink: 0, gap: "8px",
      }}>
        {/* 左侧 */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
          {/* 搜索框 */}
          <div style={{
            display: "flex", alignItems: "center", gap: "7px",
            padding: "6px 10px",
            backgroundColor: "var(--card-bg)",
            border: `1px solid ${searchFocused ? "var(--accent-blue)" : "var(--border-color)"}`,
            borderRadius: "8px", width: "200px", flexShrink: 0,
            transition: "border-color 0.15s",
          }}>
            <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              placeholder="搜索 Agent..."
              style={{ flex: 1, border: "none", outline: "none", backgroundColor: "transparent", color: "var(--text-primary)", fontSize: "13px", minWidth: 0 }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "14px", lineHeight: 1, padding: 0, outline: "none" }}>×</button>
            )}
          </div>

          <FilterDropdown label="全部模型" options={modelOptions.length ? modelOptions : ["GPT-4o", "DeepSeek-R1", "Claude 3.5 Sonnet"]} value={filterModel} onChange={setFilterModel} />
          <FilterDropdown label="全部角色" options={["分析师", "架构师", "执行者", "审查员", "创意师"]} value={filterRole} onChange={setFilterRole} />
          <ToolBtn title="高级筛选"><SlidersHorizontal size={15} /></ToolBtn>
        </div>

        {/* 右侧 */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
          <ToolBtn title="网格视图" active={viewMode === "grid"} onClick={() => setViewMode("grid")}><LayoutGrid size={15} /></ToolBtn>
          <ToolBtn title="列表视图" active={viewMode === "list"} onClick={() => setViewMode("list")}><List size={15} /></ToolBtn>
          <div style={{ width: "1px", height: "20px", backgroundColor: "var(--border-color)", margin: "0 4px" }} />
          <ToolBtn title="刷新" onClick={loadAgents}><RefreshCw size={15} /></ToolBtn>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "6px 12px", backgroundColor: "var(--accent-blue)",
              border: "none", borderRadius: "8px",
              color: "#fff", fontSize: "13px", fontWeight: 600,
              cursor: "pointer", outline: "none", whiteSpace: "nowrap", marginLeft: "4px",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
          >
            <Plus size={14} /> 新建 Agent
          </button>
        </div>
      </div>

      {/* ── 主体：卡片列表 + 详情面板 ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* 卡片区 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", color: "var(--text-muted)", fontSize: "13px" }}>
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "200px", gap: "12px" }}>
              <Sparkles size={32} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
              <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
                {search || filterModel !== "全部模型" || filterRole !== "全部角色" ? "没有匹配的 Agent" : "还没有 Agent"}
              </p>
              {!search && filterModel === "全部模型" && filterRole === "全部角色" && (
                <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>点击「新建 Agent」创建你的第一个 Agent</p>
              )}
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: viewMode === "grid" ? "repeat(auto-fill, minmax(240px, 1fr))" : "1fr",
              gap: "12px",
            }}>
              {filtered.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === selectedId}
                  onClick={() => setSelectedId(agent.id === selectedId ? null : agent.id)}
                  onDelete={() => setDeleteTarget({ id: agent.id, name: agent.name })}
                />
              ))}
            </div>
          )}
        </div>

        {/* 详情面板 */}
        {selectedAgent && (
          <DetailPanel
            agent={selectedAgent}
            onClose={() => setSelectedId(null)}
            onUpdate={(updated) => {
              setAgents(prev => prev.map(a => a.id === updated.id ? updated : a));
            }}
          />
        )}
      </div>

      {/* 新建表单 Modal */}
      {showCreate && (
        <CreateAgentModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}

      {/* 删除确认 Dialog */}
      {deleteTarget && (
        <DeleteConfirmDialog
          agentName={deleteTarget.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
