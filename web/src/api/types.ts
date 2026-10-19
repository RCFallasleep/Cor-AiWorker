/**
 * 与本地服务 API 对应的类型（server/src/cor_aiworker/api/schemas.py 与 kernel/events.py）。
 * 修改后端字段时需同步修改这里。
 */

export type Risk = "read" | "network" | "write" | "execute";
export type Decision = "allow" | "ask" | "deny";
export type RunStatus = "running" | "finished" | "failed" | "cancelled";

export interface Provider {
  name: string;
  protocol: string;
  default_model: string;
  has_key: boolean;
}

export interface Session {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail extends Session {
  active_run_id: string | null;
}

export interface Run {
  id: string;
  session_id: string;
  status: RunStatus;
  user_input: string;
  stop: string | null;
  error: string | null;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  started_at: string;
  finished_at: string | null;
}

export interface Tool {
  name: string;
  description: string;
  risk: Risk;
  untrusted: boolean;
  policy: Decision | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ── 运行事件（SSE） ──────────────────────────────────────────────────────

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | null;
  raw_arguments: string;
}

export type RunEventPayload =
  | { type: "run_started"; provider: string; model: string }
  | { type: "thinking_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall; risk: Risk }
  | {
      type: "approval_requested";
      approval_id: string;
      call_id: string;
      tool_name: string;
      risk: Risk;
      reason: string;
    }
  | { type: "approval_resolved"; approval_id: string; approved: boolean }
  | {
      type: "tool_result";
      call_id: string;
      tool_name: string;
      content: string;
      is_error: boolean;
      untrusted: boolean;
    }
  | { type: "turn_finished"; turn: number; stop: string; usage: Usage }
  | { type: "run_finished"; stop: string; turns: number; tool_calls: number; usage: Usage; elapsed: number }
  | { type: "run_failed"; error: string };

export type RunEventType = RunEventPayload["type"];

export interface RunEvent {
  seq: number;
  payload: RunEventPayload;
}

export const TERMINAL_EVENTS: ReadonlySet<RunEventType> = new Set(["run_finished", "run_failed"]);
