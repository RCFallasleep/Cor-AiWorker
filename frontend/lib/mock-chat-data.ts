// ── Mock 数据：Chat 对话 ──
// 用于 UI 开发阶段，后续替换为真实 API / SQLite 数据

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string; // "HH:mm"
  // assistant 专属元信息
  meta?: {
    thinkingSteps?: number;   // 思考步数 ↑3
    inputTokens?: number;     // ↓561
    outputTokens?: number;    // R33.7k
    wordCount?: number;       // W667
    ctxPercent?: number;      // 17% ctx
    model?: string;           // claude-4.6-sonnet-google
  };
  // 用户名（user 消息）
  username?: string;
}

export interface ChatSession {
  id: string;
  name: string;
  lastMessage: string;
  messageCount: number;
  lastActiveAt: string; // ISO string
  createdAt: string;    // ISO string
}

// ── Mock 消息列表 ──
export const mockMessages: ChatMessage[] = [
  {
    id: "msg-1",
    role: "user",
    content: "我想设计一个前端本地存储的抽象层，让业务代码不感知底层是 SQLite 还是后端 API，你有什么建议？",
    timestamp: "17:35",
    username: "openclaw-control-ui",
  },
  {
    id: "msg-2",
    role: "assistant",
    content: `好问题。这是一个经典的 **Repository Pattern**，核心思路是：

\`\`\`typescript
// 永远是这样，不管底层是什么
const repo: ChatRepository = getCurrentRepository()
const msgs = await repo.getMessages(convId)
\`\`\`

几个细节要想清楚：

1. **ID生成策略** — 本地用UUID还是自增id？后端通常有自己的主键，提前用UUID能避免id冲突
2. **时间戳** — 存UTC还是本地时间？建议UTC，显示层转换
3. **消息状态字段** — \`status: 'local' | 'synced' | 'failed'\` 要预留，不然上后端时没法区分哪些需要同步
4. **软删除** — 别用物理删除，加个 \`deleted_at\` 字段，方便后端同步时对账

最简单的验证方式：

写完SQLite实现后，**mock一个APIBackedRepository，数据全写死**，跑一遍业务流程——如果能无缝切换，说明抽象没漏。

你现在前端用什么框架？React/Vue？这决定Repository注入的方式。`,
    timestamp: "17:36",
    meta: {
      thinkingSteps: 3,
      inputTokens: 561,
      outputTokens: 33700,
      wordCount: 667,
      ctxPercent: 17,
      model: "claude-4.6-sonnet-google",
    },
  },
  {
    id: "msg-3",
    role: "user",
    content: "React+Ts，后端用py",
    timestamp: "17:37",
    username: "openclaw-control-ui",
  },
  {
    id: "msg-4",
    role: "assistant",
    content: `完美，React + TypeScript 的话，Repository 注入最自然的方式是 **Context + Hook**：

\`\`\`typescript
// types/chat-repository.ts
export interface ChatRepository {
  getSessions(): Promise<ChatSession[]>
  getMessages(sessionId: string): Promise<ChatMessage[]>
  saveMessage(msg: ChatMessage): Promise<void>
  deleteSession(sessionId: string): Promise<void>
}
\`\`\`

\`\`\`typescript
// contexts/repository-context.tsx
const RepositoryContext = createContext<ChatRepository | null>(null)

export function RepositoryProvider({ children }: { children: ReactNode }) {
  // 开发阶段用 SQLiteRepository，后续切换到 APIRepository
  const repo = useMemo(() => new SQLiteRepository(), [])
  return (
    <RepositoryContext.Provider value={repo}>
      {children}
    </RepositoryContext.Provider>
  )
}

export const useRepository = () => {
  const ctx = useContext(RepositoryContext)
  if (!ctx) throw new Error('useRepository must be used within RepositoryProvider')
  return ctx
}
\`\`\`

后端 Python 那边，FastAPI 返回的数据结构和本地 SQLite 保持一致就行，切换时只需要换一个 \`APIRepository\` 实现。

**建议的文件结构：**

\`\`\`
lib/
  repositories/
    types.ts          # 接口定义
    sqlite-repo.ts    # SQLite 实现（当前）
    api-repo.ts       # 后端 API 实现（后续）
    mock-repo.ts      # Mock 实现（测试用）
  db/
    schema.ts         # 表结构定义
    migrations/       # 数据库迁移
\`\`\`

要我帮你把 SQLite 那层先搭起来吗？用 \`wa-sqlite\` 还是 \`sql.js\`？`,
    timestamp: "17:38",
    meta: {
      thinkingSteps: 2,
      inputTokens: 892,
      outputTokens: 41200,
      wordCount: 423,
      ctxPercent: 24,
      model: "claude-4.6-sonnet-google",
    },
  },
];

// ── Mock 会话列表 ──
export const mockSessions: ChatSession[] = [
  {
    id: "session-1",
    name: "前端存储抽象层设计",
    lastMessage: "要我帮你把 SQLite 那层先搭起来吗？",
    messageCount: 4,
    lastActiveAt: "2026-06-10T17:38:00+08:00",
    createdAt: "2026-06-10T17:35:00+08:00",
  },
  {
    id: "session-2",
    name: "ChatAgent UI 规划",
    lastMessage: "我倾向于先做 Chat 的内容，这是本阶段的任务",
    messageCount: 6,
    lastActiveAt: "2026-06-10T17:20:00+08:00",
    createdAt: "2026-06-10T16:50:00+08:00",
  },
  {
    id: "session-3",
    name: "项目技术选型讨论",
    lastMessage: "后端用 FastAPI + LangChain，前端 Next.js 14",
    messageCount: 12,
    lastActiveAt: "2026-06-10T15:30:00+08:00",
    createdAt: "2026-06-10T14:00:00+08:00",
  },
];

// ── Mock 模型列表 ──
export const mockModels = [
  { id: "claude-sonnet-4-6", label: "Claude-Sonnet-4.6（很贵）", supportsVision: true },
  { id: "claude-haiku-3-5", label: "Claude-Haiku-3.5", supportsVision: true },
  { id: "gpt-4o", label: "GPT-4o", supportsVision: true },
  { id: "gpt-4o-mini", label: "GPT-4o-mini", supportsVision: false },
  { id: "deepseek-v3", label: "DeepSeek-V3", supportsVision: false },
];

// ── Mock 分支列表 ──
export const mockBranches = ["main", "dev", "feature/chat-ui", "feature/sqlite"];
