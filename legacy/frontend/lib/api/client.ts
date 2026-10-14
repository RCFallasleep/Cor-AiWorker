/**
 * 后端 API 客户端
 * 统一管理 Token 存储、请求头注入、错误处理
 *
 * 存储策略：
 *   - sessionStorage（tab 级别隔离）：避免多 tab 登录不同账号时互相覆盖
 *   - 刷新页面后 sessionStorage 仍保留（同 tab），关闭 tab 后清除
 */

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_KEY = "corwork_token";
const USER_KEY = "corwork_user";

// ── 存储适配器（sessionStorage，tab 级别隔离） ────────────────────────────────

function storage() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

// ── Token 管理 ────────────────────────────────────────────────────────────────

export function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token: string): void {
  storage()?.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  storage()?.removeItem(TOKEN_KEY);
  storage()?.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  const raw = storage()?.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function setStoredUser(user: User): void {
  storage()?.setItem(USER_KEY, JSON.stringify(user));
}

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
}

export interface AgentProfile {
  id: string;
  user_id: string;
  name: string;
  avatar_url?: string;
  description: string;
  personality: string;
  mode: "local" | "platform";
  endpoint_url?: string;
}

export interface Contact {
  id: string;
  contact_user_id: string;
  remark?: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  last_seen_at?: string;
  agent_name?: string;
  agent_avatar?: string;
  agent_desc?: string;
}

export interface FriendRequest {
  id: string;
  from_id: string;
  from_username: string;
  from_display_name: string;
  from_avatar?: string;
  from_agent_name?: string;
  message: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  msg_type: string;
  is_agent_reply: number;
  forward_from?: string;   // agent_forward 类型时，原始发起人 user_id
  read_at?: string;
  created_at: string;
}

export interface AgentMemory {
  id: string;
  user_id: string;
  agent_id?: string;
  type: "soul" | "memory" | "user" | "common";
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  peer: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
    agent_name?: string;
    agent_avatar?: string;
  };
  last_message: Message;
  unread_count: number;
}

export interface AgentInboxMessage {
  id: string;
  owner_id: string;
  sender_user_id: string | null;
  /** agent_forward | task_remind | task_report | system */
  msg_type: "agent_forward" | "task_remind" | "task_report" | "system";
  title: string;
  content: string;
  task_id: string | null;
  read_at: string | null;
  created_at: string;
  // 联表字段（列表接口返回）
  sender_username?: string;
  sender_display_name?: string;
  sender_agent_name?: string;
}

// ── 请求工具 ──────────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
  requireAuth = true
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (requireAuth && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("未授权，请重新登录");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `请求失败 ${res.status}`);
  }

  return res.json();
}

// ── Auth API ──────────────────────────────────────────────────────────────────

export const authApi = {
  async register(username: string, password: string, displayName?: string) {
    const data = await request<{ access_token: string; user: User }>(
      "/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ username, password, display_name: displayName || "" }),
      },
      false
    );
    setToken(data.access_token);
    setStoredUser(data.user);
    return data;
  },

  async login(username: string, password: string) {
    const data = await request<{ access_token: string; user: User }>(
      "/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
      false
    );
    setToken(data.access_token);
    setStoredUser(data.user);
    return data;
  },

  async me(): Promise<User> {
    return request<User>("/v1/auth/me");
  },

  logout() {
    clearToken();
  },
};

// ── Collab API ────────────────────────────────────────────────────────────────

export const collabApi = {
  // Agent 名片
  async getMyProfile(): Promise<AgentProfile> {
    return request("/v1/collab/agent-profile");
  },
  async updateProfile(data: Partial<AgentProfile>) {
    return request("/v1/collab/agent-profile", { method: "PUT", body: JSON.stringify(data) });
  },

  // 好友申请
  async sendFriendRequest(username: string, message = ""): Promise<FriendRequest> {
    return request("/v1/collab/friend-requests", {
      method: "POST",
      body: JSON.stringify({ username, message }),
    });
  },
  async listPendingRequests(): Promise<FriendRequest[]> {
    return request("/v1/collab/friend-requests/pending");
  },
  async listSentRequests() {
    return request("/v1/collab/friend-requests/sent");
  },
  async handleFriendRequest(requestId: string, action: "accept" | "reject") {
    return request(`/v1/collab/friend-requests/${requestId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  },
  async cancelFriendRequest(requestId: string) {
    return request(`/v1/collab/friend-requests/${requestId}`, { method: "DELETE" });
  },

  // 联系人
  async listContacts(): Promise<Contact[]> {
    return request("/v1/collab/contacts");
  },
  async removeContact(contactUserId: string, mutual = true) {
    return request(`/v1/collab/contacts/${contactUserId}?mutual=${mutual}`, { method: "DELETE" });
  },

  // 消息
  async getMessages(peerId: string, limit = 50, before?: string): Promise<Message[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    return request(`/v1/collab/messages/${peerId}?${params}`);
  },
  async sendMessage(receiverId: string, content: string, msgType = "text"): Promise<Message> {
    return request("/v1/collab/messages", {
      method: "POST",
      body: JSON.stringify({ receiver_id: receiverId, content, msg_type: msgType }),
    });
  },

  // 会话列表
  async listConversations(): Promise<Conversation[]> {
    return request("/v1/collab/conversations");
  },

  // 搜索用户
  async searchUsers(q: string) {
    return request(`/v1/collab/users/search?q=${encodeURIComponent(q)}`);
  },
};

// ── Memories API ──────────────────────────────────────────────────────────────

export const memoriesApi = {
  /** 获取我的所有记忆（按 type 分组） */
  async getMyMemories(): Promise<Record<string, AgentMemory[]>> {
    return request("/v1/memories/me");
  },

  /** 获取指定联系人的公共记忆（ComMemory），用于构建 Agent 对话 Prompt */
  async getPeerCommonMemories(userId: string): Promise<AgentMemory[]> {
    return request(`/v1/memories/peer/${userId}/common`);
  },

  /** 新建记忆条目 */
  async createMemory(data: {
    type: "soul" | "memory" | "user" | "common";
    title?: string;
    content: string;
    agent_id?: string;
  }): Promise<AgentMemory> {
    return request("/v1/memories", { method: "POST", body: JSON.stringify(data) });
  },

  /** 编辑记忆内容 */
  async updateMemory(id: string, data: { title?: string; content?: string }): Promise<AgentMemory> {
    return request(`/v1/memories/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },

  /** 删除记忆 */
  async deleteMemory(id: string): Promise<void> {
    await request(`/v1/memories/${id}`, { method: "DELETE" });
  },
};

// ── Skills API ────────────────────────────────────────────────────────────────

export interface SkillFile {
  id: string;
  skill_id: string;
  filename: string;
  content: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface SkillComposition {
  language: string;
  percent: number;
  chars: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** builtin | collab | custom */
  skill_type: string;
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  files?: SkillFile[];
  composition?: SkillComposition[];
  /**
   * 显式声明的工具名列表（内置 Skill 可包含多个工具）。
   * 空数组表示由前端按命名规则推断（toSnakeCase / skill_ 前缀）。
   */
  tool_names?: string[];
}

export const skillsApi = {
  /** 列出所有 Skill（可按 enabled_only 过滤） */
  async list(enabledOnly = false): Promise<{ skills: Skill[]; total: number }> {
    return request(`/v1/skills?enabled_only=${enabledOnly}`, {}, false);
  },

  /** 切换 Skill 启用状态 */
  async setEnabled(skillId: string, enabled: boolean): Promise<Skill> {
    return request(`/v1/skills/${skillId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }, false);
  },
};

// ── Agent 收件箱 API ──────────────────────────────────────────────────────────

export const agentInboxApi = {
  /** 获取收件箱消息列表（含未读数） */
  async list(opts?: { limit?: number; offset?: number; unreadOnly?: boolean }): Promise<{
    messages: AgentInboxMessage[];
    unread_count: number;
    total: number;
  }> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    if (opts?.unreadOnly) params.set("unread_only", "true");
    return request(`/v1/collab/agent-inbox?${params}`);
  },

  /** 获取未读数（轻量接口，用于角标） */
  async unreadCount(): Promise<{ unread_count: number }> {
    return request("/v1/collab/agent-inbox/unread-count");
  },

  /** 标记单条已读 */
  async markRead(msgId: string): Promise<void> {
    await request(`/v1/collab/agent-inbox/${msgId}/read`, { method: "POST" });
  },

  /** 全部标记已读 */
  async markAllRead(): Promise<void> {
    await request("/v1/collab/agent-inbox/read-all", { method: "POST" });
  },

  /** 删除一条消息 */
  async delete(msgId: string): Promise<void> {
    await request(`/v1/collab/agent-inbox/${msgId}`, { method: "DELETE" });
  },

  /** 向指定用户的 Agent 收件箱发送消息（Agent 起草页 forward_message 工具调用） */
  async send(data: {
    owner_id: string;
    msg_type?: string;
    title?: string;
    content: string;
    task_id?: string;
  }): Promise<AgentInboxMessage> {
    return request("/v1/collab/agent-inbox/send", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
};

// ── WebSocket ─────────────────────────────────────────────────────────────────

/**
 * 建立协作 WebSocket 连接。
 * - 自动从 BASE_URL 推导 ws:// / wss:// 地址
 * - 返回 WebSocket 实例，调用方负责在 cleanup 时调用 ws.close()
 */
export function createCollabWS(
  onMessage: (data: unknown) => void,
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void,
): WebSocket | null {
  const token = getToken();
  if (!token) return null;

  // http(s):// → ws(s)://
  const wsBase = BASE_URL.replace(/^https/, "wss").replace(/^http/, "ws");
  const url = `${wsBase}/v1/collab/ws?token=${token}`;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.error("[WS] 创建失败:", e);
    return null;
  }

  onStatusChange?.("connecting");

  ws.onopen = () => {
    console.info("[WS] 已连接");
    onStatusChange?.("connected");
  };

  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore malformed JSON */
    }
  };

  ws.onerror = () => {
    // onerror 的 Event 对象在浏览器里没有有效信息，真正原因在 onclose.code
    console.warn("[WS] 连接出错（详见 onclose）");
  };

  ws.onclose = (e) => {
    console.info(`[WS] 连接关闭 | code=${e.code} reason=${e.reason || "(无)"} wasClean=${e.wasClean}`);
    onStatusChange?.("disconnected");
  };

  return ws;
}
