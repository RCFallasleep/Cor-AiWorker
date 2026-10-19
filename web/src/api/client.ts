/**
 * 本地服务 API 客户端。
 *
 * 访问令牌由页面中的 <meta name="cor-aiworker-token"> 提供：生产环境由本地服务在返回页面时注入，
 * 开发环境由 Vite 插件从数据目录的 server.json 读取后注入（见 vite.config.ts）。
 * 页面与 API 同源，不涉及跨域。
 */

import type {
  ApiErrorBody,
  Decision,
  Provider,
  Run,
  Session,
  SessionDetail,
  Tool,
} from "./types";

export const TOKEN_META = "cor-aiworker-token";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function readToken(): string {
  if (typeof document === "undefined") return ""; // 非浏览器环境（单元测试）
  return document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META}"]`)?.content ?? "";
}

export function authHeaders(): Record<string, string> {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error?.code) return new ApiError(response.status, body.error.code, body.error.message);
  } catch {
    // 不是我们的错误格式（例如代理返回的错误页），使用下面的通用信息
  }
  return new ApiError(response.status, "http_error", `请求失败（HTTP ${response.status}）`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ status: string }>("GET", "/api/health"),

  providers: () => request<Provider[]>("GET", "/api/providers"),
  setApiKey: (name: string, key: string) =>
    request<void>("PUT", `/api/providers/${enc(name)}/key`, { key }),
  deleteApiKey: (name: string) => request<void>("DELETE", `/api/providers/${enc(name)}/key`),

  sessions: (limit = 50) => request<Session[]>("GET", `/api/sessions?limit=${limit}`),
  createSession: (provider: string, model?: string) =>
    request<Session>("POST", "/api/sessions", { provider, model }),
  session: (id: string) => request<SessionDetail>("GET", `/api/sessions/${enc(id)}`),
  renameSession: (id: string, title: string) =>
    request<Session>("PATCH", `/api/sessions/${enc(id)}`, { title }),
  deleteSession: (id: string) => request<void>("DELETE", `/api/sessions/${enc(id)}`),

  runs: (sessionId: string) => request<Run[]>("GET", `/api/sessions/${enc(sessionId)}/runs`),
  startRun: (sessionId: string, input: string) =>
    request<{ run_id: string }>("POST", `/api/sessions/${enc(sessionId)}/runs`, { input }),
  run: (id: string) => request<Run>("GET", `/api/runs/${enc(id)}`),
  answerApproval: (runId: string, approvalId: string, approved: boolean) =>
    request<void>("POST", `/api/runs/${enc(runId)}/approvals/${enc(approvalId)}`, { approved }),
  cancelRun: (id: string) => request<void>("POST", `/api/runs/${enc(id)}/cancel`),

  tools: () => request<Tool[]>("GET", "/api/tools"),
  setToolPolicy: (name: string, decision: Decision) =>
    request<void>("PUT", `/api/tools/${enc(name)}/policy`, { decision }),
  clearToolPolicy: (name: string) => request<void>("DELETE", `/api/tools/${enc(name)}/policy`),
};
