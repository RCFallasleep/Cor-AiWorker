"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Coins,
  Layers,
  Search,
  Globe,
  Wrench,
  AlertCircle,
} from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface ToolCallLog {
  name: string;
  args: Record<string, unknown>;
  result_preview: string;
  duration_ms: number;
  success: boolean;
}

interface AgentRoundLog {
  round_index: number;
  started_at: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  finish_reason: string;
  thinking_text: string;
  tool_calls: ToolCallLog[];
}

interface AgentRunLog {
  run_id: string;
  session_id: string;
  model: string;
  user_query: string;
  started_at: string;
  finished_at: string | null;
  total_duration_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_rounds: number;
  status: "running" | "done" | "error";
  error_message: string;
  rounds?: AgentRoundLog[];
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

// ── 工具图标映射 ──────────────────────────────────────────────────────────────

function ToolIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("search") || lower.includes("web")) {
    return <Globe size={12} />;
  }
  return <Wrench size={12} />;
}

// ── 格式化辅助 ────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── 状态徽章 ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AgentRunLog["status"] }) {
  const map = {
    done:    { icon: <CheckCircle2 size={11} />, label: "完成",  color: "var(--color-success, #22c55e)" },
    error:   { icon: <XCircle size={11} />,      label: "错误",  color: "#ef4444" },
    running: { icon: <Loader2 size={11} className="animate-spin" />, label: "运行中", color: "var(--text-muted)" },
  };
  const { icon, label, color } = map[status] ?? map.running;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color, fontSize: "11px", fontWeight: 500 }}>
      {icon}{label}
    </span>
  );
}

// ── 工具调用节点 ──────────────────────────────────────────────────────────────

function ToolCallNode({ tc }: { tc: ToolCallLog }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: `1px solid ${tc.success ? "var(--border)" : "rgba(239,68,68,0.3)"}`,
        borderRadius: "6px",
        overflow: "hidden",
        fontSize: "12px",
      }}
    >
      {/* 头部 */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          background: "var(--surface-secondary)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-primary)",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <ToolIcon name={tc.name} />
        <span style={{ fontWeight: 500, flex: 1 }}>{tc.name}</span>
        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{fmtDuration(tc.duration_ms)}</span>
        {!tc.success && <XCircle size={11} color="#ef4444" />}
      </button>

      {/* 展开内容 */}
      {open && (
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px", background: "var(--surface)" }}>
          {/* 参数 */}
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: "11px", marginBottom: "3px" }}>参数</div>
            <pre
              style={{
                margin: 0,
                padding: "6px 8px",
                background: "var(--surface-secondary)",
                borderRadius: "4px",
                fontSize: "11px",
                color: "var(--text-secondary)",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
          {/* 结果预览 */}
          {tc.result_preview && (
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: "11px", marginBottom: "3px" }}>结果预览</div>
              <div
                style={{
                  padding: "6px 8px",
                  background: "var(--surface-secondary)",
                  borderRadius: "4px",
                  fontSize: "11px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                  maxHeight: "80px",
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {tc.result_preview}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 单轮日志 ──────────────────────────────────────────────────────────────────

function RoundRow({ round }: { round: AgentRoundLog }) {
  const [open, setOpen] = useState(false);
  const isFinal = round.finish_reason === "stop" || round.tool_calls.length === 0;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "6px",
        overflow: "hidden",
      }}
    >
      {/* 轮次头部 */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          background: "var(--surface-secondary)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-primary)",
          fontSize: "12px",
        }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span
          style={{
            padding: "1px 6px",
            borderRadius: "4px",
            background: isFinal ? "rgba(34,197,94,0.12)" : "rgba(99,102,241,0.12)",
            color: isFinal ? "#22c55e" : "#818cf8",
            fontSize: "11px",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          Round {round.round_index}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: "11px", flexShrink: 0 }}>
          {fmtTime(round.started_at)}
        </span>
        <span style={{ flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {round.tool_calls.length > 0
            ? round.tool_calls.map((tc) => tc.name).join(" → ")
            : isFinal ? "最终回复" : "思考中"}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: "11px", flexShrink: 0 }}>{fmtDuration(round.duration_ms)}</span>
        <span style={{ color: "var(--text-muted)", fontSize: "11px", flexShrink: 0 }}>
          {fmtTokens(round.input_tokens + round.output_tokens)} tok
        </span>
      </button>

      {/* 展开内容 */}
      {open && (
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* 思考文字 */}
          {round.thinking_text && (
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: "11px", marginBottom: "4px" }}>思考过程（节选）</div>
              <div
                style={{
                  padding: "8px 10px",
                  background: "var(--surface-secondary)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  fontStyle: "italic",
                  borderLeft: "2px solid var(--border)",
                }}
              >
                {round.thinking_text}
              </div>
            </div>
          )}

          {/* 工具调用列表 */}
          {round.tool_calls.length > 0 && (
            <div>
              <div style={{ color: "var(--text-muted)", fontSize: "11px", marginBottom: "4px" }}>
                工具调用（{round.tool_calls.length} 次）
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {round.tool_calls.map((tc, i) => (
                  <ToolCallNode key={i} tc={tc} />
                ))}
              </div>
            </div>
          )}

          {/* Token 统计 */}
          <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--text-muted)" }}>
            <span>输入 {fmtTokens(round.input_tokens)} tok</span>
            <span>输出 {fmtTokens(round.output_tokens)} tok</span>
            <span>finish: {round.finish_reason || "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 单条执行记录 ──────────────────────────────────────────────────────────────

function RunRow({ run, onExpand }: { run: AgentRunLog; onExpand: (id: string) => void }) {
  const [open, setOpen] = useState(false);

  const handleToggle = () => {
    if (!open && !run.rounds) {
      onExpand(run.run_id);
    }
    setOpen((v) => !v);
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      {/* 主行 */}
      <button
        onClick={handleToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-primary)",
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

        {/* 状态 */}
        <StatusBadge status={run.status} />

        {/* 时间 */}
        <span style={{ color: "var(--text-muted)", fontSize: "11px", flexShrink: 0 }}>
          {fmtDate(run.started_at)} {fmtTime(run.started_at)}
        </span>

        {/* 用户问题 */}
        <span
          style={{
            flex: 1,
            fontSize: "13px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--text-primary)",
          }}
        >
          {run.user_query || "（无内容）"}
        </span>

        {/* 统计信息 */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexShrink: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: "var(--text-muted)" }}>
            <Layers size={11} />{run.total_rounds} 轮
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: "var(--text-muted)" }}>
            <Clock size={11} />{fmtDuration(run.total_duration_ms)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: "var(--text-muted)" }}>
            <Coins size={11} />{fmtTokens(run.total_input_tokens + run.total_output_tokens)}
          </span>
        </div>
      </button>

      {/* 展开：轮次详情 */}
      {open && (
        <div
          style={{
            padding: "0 16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            borderTop: "1px solid var(--border)",
            paddingTop: "12px",
          }}
        >
          {/* 元信息 */}
          <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>
            <span>模型：{run.model}</span>
            <span>会话：{run.session_id.slice(0, 8)}…</span>
            <span>输入 {fmtTokens(run.total_input_tokens)} / 输出 {fmtTokens(run.total_output_tokens)} tok</span>
            {run.error_message && (
              <span style={{ color: "#ef4444" }}>
                <AlertCircle size={11} style={{ display: "inline", marginRight: "3px" }} />
                {run.error_message}
              </span>
            )}
          </div>

          {/* 轮次列表 */}
          {run.rounds && run.rounds.length > 0 ? (
            run.rounds.map((r) => <RoundRow key={r.round_index} round={r} />)
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: "12px", padding: "8px 0" }}>
              加载中…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [runs, setRuns] = useState<AgentRunLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState("");
  const [sessionInput, setSessionInput] = useState("");

  const fetchLogs = useCallback(async (sid?: string) => {
    if (!BACKEND_URL) {
      setError("未配置后端地址（NEXT_PUBLIC_BACKEND_URL），无法加载日志。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (sid) params.set("session_id", sid);
      const res = await fetch(`${BACKEND_URL}/v1/logs/?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载单条详情（含 rounds）
  const expandRun = useCallback(async (runId: string) => {
    if (!BACKEND_URL) return;
    try {
      const res = await fetch(`${BACKEND_URL}/v1/logs/${runId}`);
      if (!res.ok) return;
      const detail: AgentRunLog = await res.json();
      setRuns((prev) => prev.map((r) => r.run_id === runId ? { ...r, rounds: detail.rounds } : r));
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    const sid = sessionInput.trim();
    setSessionFilter(sid);
    fetchLogs(sid || undefined);
  };

  const handleClear = () => {
    setSessionInput("");
    setSessionFilter("");
    fetchLogs();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        padding: "20px 24px",
        gap: "16px",
      }}
    >
      {/* 顶部标题栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
            Agent 执行日志
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            记录每次 LLM 调用的轮次、工具调用、耗时与 Token 用量
          </p>
        </div>

        {/* 刷新按钮 */}
        <button
          onClick={() => fetchLogs(sessionFilter || undefined)}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-secondary)",
            fontSize: "12px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>

      {/* 筛选栏 */}
      <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flex: 1,
            maxWidth: "360px",
            padding: "6px 10px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            value={sessionInput}
            onChange={(e) => setSessionInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="按会话 ID 筛选…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "12px",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <button
          onClick={handleSearch}
          style={{
            padding: "6px 14px",
            borderRadius: "6px",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text-secondary)",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          搜索
        </button>
        {sessionFilter && (
          <button
            onClick={handleClear}
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            清除
          </button>
        )}

        {/* 总数 */}
        <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--text-muted)", alignSelf: "center" }}>
          共 {total} 条记录
        </span>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "6px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
            fontSize: "12px",
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* 日志列表 */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
        {loading && runs.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "120px", color: "var(--text-muted)", fontSize: "13px", gap: "8px" }}>
            <Loader2 size={16} className="animate-spin" />
            加载中…
          </div>
        ) : runs.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "160px", gap: "8px", color: "var(--text-muted)" }}>
            <Layers size={32} style={{ opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: "13px" }}>暂无日志</p>
            <p style={{ margin: 0, fontSize: "12px" }}>发送一条消息后，Agent 执行记录将在此显示</p>
          </div>
        ) : (
          runs.map((run) => (
            <RunRow key={run.run_id} run={run} onExpand={expandRun} />
          ))
        )}
      </div>
    </div>
  );
}
