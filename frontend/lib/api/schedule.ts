/**
 * 定时任务 API 客户端
 * 封装 /v1/schedule/* 接口
 */

import { getToken } from "./client";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  user_id: string;
  target_user_id: string;
  title: string;
  trigger_type: "once" | "cron";
  trigger_at: string | null;
  cron_expr: string | null;
  action_type: "remind" | "agent_run";
  action_payload: string;
  status: "active" | "paused" | "done" | "cancelled";
  created_at: string;
  next_run_at: string | null;
  // 聚合字段（后端 JOIN 计算）
  run_count?: number;
  last_run_status?: "success" | "failed" | "running" | null;
  last_run_at?: string | null;
}

export interface TaskRun {
  id: string;
  task_id: string;
  started_at: string;
  finished_at: string | null;
  status: "success" | "failed" | "running";
  result: string;
}

// ── 请求工具 ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── API 方法 ──────────────────────────────────────────────────────────────────

export const scheduleApi = {
  /** 查询当前用户的定时任务列表 */
  listTasks(status?: string): Promise<ScheduledTask[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<ScheduledTask[]>(`/v1/schedule/tasks${qs}`);
  },

  /** 查询任务执行记录 */
  listRuns(taskId: string, limit = 20): Promise<TaskRun[]> {
    return request<TaskRun[]>(`/v1/schedule/tasks/${taskId}/runs?limit=${limit}`);
  },

  /** 暂停任务 */
  pauseTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/schedule/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paused" }),
    });
  },

  /** 恢复任务 */
  resumeTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/schedule/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    });
  },

  /** 取消任务 */
  cancelTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/schedule/tasks/${taskId}`, {
      method: "DELETE",
    });
  },
};

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 格式化触发时间描述 */
export function formatTrigger(task: ScheduledTask): string {
  if (task.trigger_type === "once") {
    if (!task.trigger_at) return "-";
    const d = new Date(task.trigger_at);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  // cron 类型：尝试友好描述
  return task.cron_expr ? `周期 (${task.cron_expr})` : "-";
}

/** 格式化下次执行时间（倒计时） */
export function formatNextRun(task: ScheduledTask): string {
  if (task.status !== "active" || !task.next_run_at) return "-";
  const diff = new Date(task.next_run_at).getTime() - Date.now();
  if (diff <= 0) return "即将执行";
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} 天后`;
  if (hours > 0) return `${hours} 小时后`;
  return `${mins} 分钟后`;
}

/** 状态标签 */
export function statusLabel(status: ScheduledTask["status"]): string {
  return { active: "运行中", paused: "已暂停", done: "已完成", cancelled: "已取消" }[status] ?? status;
}

/** 状态颜色 */
export function statusColor(status: ScheduledTask["status"]): string {
  return (
    { active: "#22c55e", paused: "#f59e0b", done: "#6b7280", cancelled: "#ef4444" }[status] ?? "#6b7280"
  );
}
