"use client";

/**
 * 定时任务工作台 — /workbench/schedule
 *
 * 布局：左侧任务列表 + 右侧任务详情/执行记录
 * 任务通过聊天中的 Agent 工具创建，此页面只做查看和管理。
 */

import { useEffect, useState, useCallback } from "react";
import {
  Timer, Clock, RefreshCw, Trash2, Pause, Play,
  ChevronRight, CheckCircle2, XCircle, Loader2, AlertCircle,
} from "lucide-react";
import {
  scheduleApi,
  type ScheduledTask,
  type TaskRun,
  formatTrigger,
  formatNextRun,
  statusLabel,
  statusColor,
} from "@/lib/api/schedule";

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await scheduleApi.listTasks(filterStatus);
      setTasks(data);
      // 如果当前选中的任务在新列表中，更新它
      if (selectedTask) {
        const updated = data.find((t) => t.id === selectedTask.id);
        if (updated) setSelectedTask(updated);
      }
    } catch (e) {
      console.error("load tasks failed", e);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, selectedTask]);

  useEffect(() => {
    loadTasks();
  }, [filterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRuns = useCallback(async (taskId: string) => {
    setRunsLoading(true);
    try {
      const data = await scheduleApi.listRuns(taskId);
      setRuns(data);
    } catch (e) {
      console.error("load runs failed", e);
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const handleSelectTask = (task: ScheduledTask) => {
    setSelectedTask(task);
    loadRuns(task.id);
  };

  const handlePauseResume = async (task: ScheduledTask) => {
    setActionLoading(task.id);
    try {
      if (task.status === "active") {
        await scheduleApi.pauseTask(task.id);
      } else {
        await scheduleApi.resumeTask(task.id);
      }
      await loadTasks();
    } catch (e) {
      console.error("pause/resume failed", e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (task: ScheduledTask) => {
    if (!confirm(`确认取消任务「${task.title}」？`)) return;
    setActionLoading(task.id);
    try {
      await scheduleApi.cancelTask(task.id);
      if (selectedTask?.id === task.id) {
        setSelectedTask(null);
        setRuns([]);
      }
      await loadTasks();
    } catch (e) {
      console.error("cancel failed", e);
    } finally {
      setActionLoading(null);
    }
  };

  const activeTasks = tasks.filter((t) => t.status === "active");
  const otherTasks = tasks.filter((t) => t.status !== "active");

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", backgroundColor: "var(--background)" }}>

      {/* ── 左侧任务列表 ── */}
      <div style={{
        width: "300px",
        flexShrink: 0,
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* 列表头 */}
        <div style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <Timer size={15} style={{ color: "var(--text-muted)" }} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
              定时任务
            </span>
            {tasks.length > 0 && (
              <span style={{
                fontSize: "10px", padding: "1px 6px", borderRadius: "10px",
                backgroundColor: "rgba(99,102,241,0.12)", color: "#818cf8",
              }}>
                {tasks.length}
              </span>
            )}
          </div>
          <button
            onClick={loadTasks}
            title="刷新"
            style={{
              width: "26px", height: "26px", borderRadius: "6px", border: "none",
              cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* 状态筛选 */}
        <div style={{ padding: "8px 12px", display: "flex", gap: "4px", flexShrink: 0 }}>
          {[
            { label: "全部", value: undefined },
            { label: "运行中", value: "active" },
            { label: "已完成", value: "done" },
            { label: "已取消", value: "cancelled" },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => setFilterStatus(opt.value)}
              style={{
                fontSize: "11px", padding: "3px 8px", borderRadius: "10px", border: "none",
                cursor: "pointer",
                backgroundColor: filterStatus === opt.value ? "rgba(99,102,241,0.15)" : "transparent",
                color: filterStatus === opt.value ? "#818cf8" : "var(--text-muted)",
                fontWeight: filterStatus === opt.value ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* 任务列表 */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              加载中...
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {activeTasks.length > 0 && (
                <TaskGroup
                  label="运行中"
                  tasks={activeTasks}
                  selectedId={selectedTask?.id}
                  actionLoading={actionLoading}
                  onSelect={handleSelectTask}
                  onPauseResume={handlePauseResume}
                  onCancel={handleCancel}
                />
              )}
              {otherTasks.length > 0 && (
                <TaskGroup
                  label="历史"
                  tasks={otherTasks}
                  selectedId={selectedTask?.id}
                  actionLoading={actionLoading}
                  onSelect={handleSelectTask}
                  onPauseResume={handlePauseResume}
                  onCancel={handleCancel}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 右侧详情 ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            runs={runs}
            runsLoading={runsLoading}
            actionLoading={actionLoading}
            onPauseResume={handlePauseResume}
            onCancel={handleCancel}
            onRefreshRuns={() => loadRuns(selectedTask.id)}
          />
        ) : (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "10px",
          }}>
            <Timer size={40} style={{ color: "var(--text-muted)" }} />
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>
              选择一个任务查看详情
            </p>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
              在聊天中说「提醒我...」即可创建定时任务
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 空状态 ────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      padding: "40px 20px", textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
    }}>
      <Timer size={32} style={{ color: "var(--text-muted)" }} />
      <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>
        暂无定时任务
      </p>
      <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
        在聊天中告诉 Agent<br />
        「明天早上 9 点提醒我开会」<br />
        即可自动创建
      </p>
    </div>
  );
}

// ── 任务分组 ──────────────────────────────────────────────────────────────────

function TaskGroup({
  label,
  tasks,
  selectedId,
  actionLoading,
  onSelect,
  onPauseResume,
  onCancel,
}: {
  label: string;
  tasks: ScheduledTask[];
  selectedId?: string;
  actionLoading: string | null;
  onSelect: (t: ScheduledTask) => void;
  onPauseResume: (t: ScheduledTask) => void;
  onCancel: (t: ScheduledTask) => void;
}) {
  return (
    <div>
      <div style={{
        padding: "6px 16px 4px",
        fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em",
        color: "var(--text-muted)", textTransform: "uppercase",
      }}>
        {label}
      </div>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          isSelected={task.id === selectedId}
          isActionLoading={actionLoading === task.id}
          onSelect={() => onSelect(task)}
          onPauseResume={() => onPauseResume(task)}
          onCancel={() => onCancel(task)}
        />
      ))}
    </div>
  );
}

// ── 任务卡片 ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  isSelected,
  isActionLoading,
  onSelect,
  onPauseResume,
  onCancel,
}: {
  task: ScheduledTask;
  isSelected: boolean;
  isActionLoading: boolean;
  onSelect: () => void;
  onPauseResume: () => void;
  onCancel: () => void;
}) {
  const canPauseResume = task.status === "active" || task.status === "paused";
  const canCancel = task.status === "active" || task.status === "paused";

  return (
    <div
      onClick={onSelect}
      style={{
        padding: "10px 16px",
        cursor: "pointer",
        backgroundColor: isSelected ? "rgba(99,102,241,0.08)" : "transparent",
        borderLeft: isSelected ? "2px solid #818cf8" : "2px solid transparent",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "var(--sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        {/* 状态指示点 */}
        <div style={{
          width: "7px", height: "7px", borderRadius: "50%",
          backgroundColor: statusColor(task.status),
          marginTop: "5px", flexShrink: 0,
          boxShadow: task.status === "active" ? `0 0 6px ${statusColor(task.status)}` : "none",
        }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: "13px", fontWeight: 500, color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {task.title}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", display: "flex", alignItems: "center", gap: "4px" }}>
            <Clock size={9} />
            {task.trigger_type === "once" ? "一次性" : "周期"}
            {" · "}
            {task.status === "active" ? formatNextRun(task) : formatTrigger(task)}
          </div>
        </div>

        {/* 操作按钮 */}
        {!isActionLoading && (
          <div style={{ display: "flex", gap: "2px", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {canPauseResume && (
              <button
                onClick={onPauseResume}
                title={task.status === "active" ? "暂停" : "恢复"}
                style={{
                  width: "22px", height: "22px", borderRadius: "5px", border: "none",
                  cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                {task.status === "active" ? <Pause size={11} /> : <Play size={11} />}
              </button>
            )}
            {canCancel && (
              <button
                onClick={onCancel}
                title="取消任务"
                style={{
                  width: "22px", height: "22px", borderRadius: "5px", border: "none",
                  cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "rgba(239,68,68,0.1)"; e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )}
        {isActionLoading && (
          <Loader2 size={13} style={{ color: "var(--text-muted)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
        )}
      </div>
    </div>
  );
}

// ── 任务详情 ──────────────────────────────────────────────────────────────────

function TaskDetail({
  task,
  runs,
  runsLoading,
  actionLoading,
  onPauseResume,
  onCancel,
  onRefreshRuns,
}: {
  task: ScheduledTask;
  runs: TaskRun[];
  runsLoading: boolean;
  actionLoading: string | null;
  onPauseResume: (t: ScheduledTask) => void;
  onCancel: (t: ScheduledTask) => void;
  onRefreshRuns: () => void;
}) {
  const isLoading = actionLoading === task.id;
  const canPauseResume = task.status === "active" || task.status === "paused";
  const canCancel = task.status === "active" || task.status === "paused";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 详情头 */}
      <div style={{
        padding: "16px 24px",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%",
                backgroundColor: statusColor(task.status),
                boxShadow: task.status === "active" ? `0 0 8px ${statusColor(task.status)}` : "none",
                flexShrink: 0,
              }} />
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
                {task.title}
              </h2>
            </div>

            {/* 元信息 */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
              <MetaItem label="状态" value={statusLabel(task.status)} />
              <MetaItem label="类型" value={task.trigger_type === "once" ? "一次性" : "周期"} />
              <MetaItem
                label={task.trigger_type === "once" ? "触发时间" : "Cron 表达式"}
                value={task.trigger_type === "once" ? (task.trigger_at ? new Date(task.trigger_at).toLocaleString("zh-CN") : "-") : (task.cron_expr ?? "-")}
              />
              {task.status === "active" && task.next_run_at && (
                <MetaItem label="下次执行" value={formatNextRun(task)} highlight />
              )}
              <MetaItem label="执行次数" value={String(task.run_count ?? 0)} />
              <MetaItem label="创建时间" value={new Date(task.created_at).toLocaleString("zh-CN")} />
            </div>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            {canPauseResume && (
              <button
                onClick={() => onPauseResume(task)}
                disabled={isLoading}
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "6px 12px", borderRadius: "8px",
                  border: "1px solid var(--border-color)",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  backgroundColor: "transparent", color: "var(--text-secondary)",
                  fontSize: "12px", fontWeight: 500,
                }}
              >
                {task.status === "active" ? <Pause size={12} /> : <Play size={12} />}
                {task.status === "active" ? "暂停" : "恢复"}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => onCancel(task)}
                disabled={isLoading}
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "6px 12px", borderRadius: "8px",
                  border: "1px solid rgba(239,68,68,0.3)",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  backgroundColor: "rgba(239,68,68,0.06)", color: "#ef4444",
                  fontSize: "12px", fontWeight: 500,
                }}
              >
                <Trash2 size={12} />
                取消任务
              </button>
            )}
          </div>
        </div>

        {/* 提醒内容 */}
        {task.action_payload && (
          <div style={{
            marginTop: "12px", padding: "10px 14px", borderRadius: "8px",
            backgroundColor: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)",
            fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6,
          }}>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", marginRight: "6px" }}>提醒内容：</span>
            {task.action_payload}
          </div>
        )}
      </div>

      {/* 执行记录 */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{
          padding: "12px 24px 8px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            执行记录
          </span>
          <button
            onClick={onRefreshRuns}
            title="刷新记录"
            style={{
              width: "24px", height: "24px", borderRadius: "6px", border: "none",
              cursor: "pointer", backgroundColor: "transparent", color: "var(--text-muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--sidebar-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <RefreshCw size={11} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 16px" }}>
          {runsLoading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              加载中...
            </div>
          ) : runs.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              暂无执行记录
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {runs.map((run) => (
                <RunCard key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── 元信息项 ──────────────────────────────────────────────────────────────────

function MetaItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "12px", color: highlight ? "#22c55e" : "var(--text-secondary)", fontWeight: highlight ? 600 : 400 }}>
        {value}
      </div>
    </div>
  );
}

// ── 执行记录卡片 ──────────────────────────────────────────────────────────────

function RunCard({ run }: { run: TaskRun }) {
  const [expanded, setExpanded] = useState(false);

  const icon =
    run.status === "success" ? <CheckCircle2 size={14} color="#22c55e" /> :
    run.status === "failed" ? <XCircle size={14} color="#ef4444" /> :
    <Loader2 size={14} color="#f59e0b" style={{ animation: "spin 1s linear infinite" }} />;

  const statusText =
    run.status === "success" ? "成功" :
    run.status === "failed" ? "失败" : "执行中";

  const statusClr =
    run.status === "success" ? "#22c55e" :
    run.status === "failed" ? "#ef4444" : "#f59e0b";

  return (
    <div style={{
      borderRadius: "8px",
      border: "1px solid var(--border-subtle)",
      overflow: "hidden",
    }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: "8px",
          padding: "10px 14px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {icon}
        <span style={{ fontSize: "12px", color: statusClr, fontWeight: 500, minWidth: "36px" }}>
          {statusText}
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", flex: 1 }}>
          {new Date(run.started_at).toLocaleString("zh-CN")}
        </span>
        <ChevronRight
          size={12}
          style={{
            color: "var(--text-muted)",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {expanded && run.result && (
        <div style={{
          padding: "0 14px 12px",
          fontSize: "12px", color: "var(--text-secondary)",
          lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: "10px",
        }}>
          {run.result}
        </div>
      )}
    </div>
  );
}
