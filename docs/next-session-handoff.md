# Cor-AiWorker — 下一个对话交接文档

> 生成时间：2026-06-15
> 当前对话已接近上下文上限，本文档用于无缝衔接下一个对话。

---

## 一、项目概览

**项目名**：Cor-AiWorker
**定位**：基于多 Agent 协作的团队开发对齐系统
**核心功能**：多个 AI Agent 组成虚拟团队，对同一议题进行协作推演，最终产出综合结论

### 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 App Router + TypeScript + Tailwind CSS（inline style 为主） |
| 后端 | Python 3.12 + FastAPI + asyncio，Docker 容器运行 |
| 前端本地存储 | IndexedDB（idb 库）存 Agent；sql.js（SQLite）存 API Key |
| 流式通信 | SSE（Server-Sent Events），后端 `StreamingResponse` |
| LLM 调用 | openai Python SDK（兼容 OpenAI / Anthropic / 国内代理） |

### 目录结构

```
Cor-AiWorker/
├── frontend/
│   ├── app/
│   │   ├── corwork/think-tank/page.tsx   ← 核心页面（2500+ 行，所有组件在一个文件）
│   │   ├── health/agent/page.tsx          ← Agent 管理页
│   │   └── settings/apikey/              ← API Key 管理
│   └── lib/
│       ├── db/idb.ts                      ← IndexedDB Agent 存储
│       ├── db/sqlite.ts                   ← sql.js API Key 存储
│       └── repositories/                  ← agentRepo / apiKeyRepo
├── backend/
│   └── app/
│       ├── main.py                        ← FastAPI 入口，路由注册
│       ├── api/v1/
│       │   ├── organize.py                ← POST /v1/organize, GET /v1/organize/templates
│       │   └── deduction.py               ← POST /v1/deduction
│       ├── services/
│       │   ├── organize_service.py        ← 组织阶段 LLM 调用
│       │   └── deduction_service.py       ← 推演阶段并行调用（当前：简单并行）
│       └── schemas/chat.py                ← 所有 Pydantic Schema
└── docs/
    ├── iteration-log.md                   ← 完整迭代记录
    └── next-session-handoff.md            ← 本文件
```

---

## 二、当前已完成的功能（Phase 3 现状）

### 4 步流程（前端 `/corwork/think-tank`）

```
Step 0 组建团队 → Step 1 提出议题 → Step 2 并行推演 → Step 3 结果产出
```

#### Step 0：组建团队（`StepTeam`）
- 从 IndexedDB 读取用户创建的 Agent 列表
- 多选 Agent，设置一个「组织者」（金色皇冠）

#### Step 1：提出议题（`StepTopic`）
- 输入推演议题文字

#### Step 2：并行推演（`StepDeduction`）—— 最复杂的组件
- **组织阶段**：左侧面板，组织者 Agent 调用 LLM，为每个 Agent 分配职位 + 任务 Prompt + 汇报关系
  - 后端：`POST /v1/organize` → SSE（`thinking_delta` / `done` / `error`）
  - 完成后星图显示有向边（edges）和职位胶囊标签
- **推演阶段**：组织完成后点「开始推演」
  - 后端：`POST /v1/deduction` → SSE（`agent_start` / `delta` / `agent_done` / `agent_error` / `all_done`）
  - 当前实现：所有 Agent **并行独立**调用 LLM，互不知道对方的输出
  - 前端右侧面板实时展示各 Agent 的流式输出
  - 推演完成后显示「查看结果」按钮（金色）

#### Step 3：结果产出（`StepResult`）
- 展示各 Agent 推演结论的汇总卡片（只读）
- 底部「导出报告」按钮（预留，disabled）
- 底部「新一轮推演」按钮

### 关键数据结构

```typescript
// 前端顶层接口（page.tsx 顶部）
interface DeductionMessage {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  agentIcon: string;
  text: string;           // 推演输出全文
  status: "working" | "done" | "error";
  errorMsg?: string;
  timestamp: number;
}

interface OrganizeEdge {
  from: string;           // Agent ID
  to: string;             // Agent ID
  label: string;          // 关系描述，如「汇报」「协作」
}

interface NodeData {
  id: string;
  agent: AgentRow;
  x: number; y: number;  // 星图坐标
  isOrganizer: boolean;
  status: "idle" | "working" | "done" | "error";
  role?: string;          // 组织阶段分配的职位
  taskPrompt?: string;    // 组织阶段分配的任务
  reportsTo?: string | null;
}
```

```python
# 后端 Schema（schemas/chat.py）
class AgentDeductionConfig(BaseModel):
    id: str
    name: str
    model: str
    system_prompt: str
    role: str           # 组织阶段分配的职位
    task_prompt: str    # 组织阶段分配的任务 Prompt
    api_key: str
    base_url: str | None
    extra_headers: dict | None

class DeductionRequest(BaseModel):
    topic: str
    agents: list[AgentDeductionConfig]
```

### 已知的重要 Bug 修复记录

1. **React setState 嵌套问题**：在 `setDeductMessages` updater 里不能调用父组件的 setState（`onDeductDone`）。
   - 修复方案：用 `pendingDoneRef = useRef<DeductionMessage[] | null>(null)` 暂存，在 `useEffect` 监听 `deductPhase === "done"` 时统一触发。

2. **Docker 容器未重建**：后端新增路由后需要 `docker compose build && docker compose up --force-recreate`，否则 404。

3. **AsyncOpenAI 不支持 `.stream()`**：需用 `create(stream=True)` 异步流式调用。

---

## 三、下一步要做的事（方案 C：图结构消息传递）

### 背景与目标

**当前问题**：推演阶段各 Agent 完全独立，互不知道对方的输出，不是真正的协作。

**目标**：按组织阶段生成的 `edges`（有向图）决定消息流向。
- 例如：前端工程师完成后，其输出自动注入架构师的上下文，架构师再基于此输出
- 这样观众能看到「Agent 真实地影响彼此」

**产品价值**：edges 数据已经有了（组织阶段生成），这是方案 C 最难的部分已经解决。

---

## 四、方案 C 详细实现计划

### 4.1 核心思路

```
组织阶段已生成 edges：
  前端工程师 → 架构师（汇报）
  后端工程师 → 架构师（汇报）
  架构师 → 组织者（汇报）

推演执行顺序（拓扑排序）：
  Round 1（入度为 0 的节点并行）：前端工程师、后端工程师
  Round 2（依赖 Round 1 完成）：架构师（收到前端+后端的输出作为上下文）
  Round 3（依赖 Round 2 完成）：组织者（收到架构师的输出，生成综合结论）
```

### 4.2 后端改造（`deduction_service.py`）

**新增 Schema**（`schemas/chat.py`）：
```python
class EdgeConfig(BaseModel):
    from_id: str = Field(..., alias="from")
    to_id: str   = Field(..., alias="to")
    label: str   = ""
    model_config = {"populate_by_name": True}

class GraphDeductionRequest(BaseModel):
    topic: str
    agents: list[AgentDeductionConfig]
    edges: list[EdgeConfig]             # 新增：组织阶段生成的有向边
```

**新增 SSE 事件类型**：
```python
# 现有事件（保持不变）：
# agent_start / delta / agent_done / agent_error / all_done

# 新增事件：
{"type": "round_start", "round": 1, "agent_ids": ["id1", "id2"]}
{"type": "round_done",  "round": 1}
{"type": "agent_waiting", "agent_id": "...", "waiting_for": ["id1", "id2"]}
```

**图调度器核心逻辑**（新建 `services/graph_deduction_service.py`）：

```python
async def stream_graph_deduction(request: GraphDeductionRequest) -> AsyncGenerator[str, None]:
    # 1. 建邻接表和入度表
    in_degree = {a.id: 0 for a in request.agents}
    dependents = {a.id: [] for a in request.agents}  # 谁依赖我
    dependencies = {a.id: [] for a in request.agents} # 我依赖谁

    for edge in request.edges:
        # edge.from → edge.to 表示 from 的输出流向 to
        # 即 to 依赖 from
        in_degree[edge.to_id] += 1
        dependents[edge.from_id].append(edge.to_id)
        dependencies[edge.to_id].append(edge.from_id)

    # 2. 存储每个 Agent 的完整输出
    agent_outputs: dict[str, str] = {}
    completed = asyncio.Event()  # 全部完成信号

    # 3. 用 asyncio.Queue 驱动调度
    ready_queue: asyncio.Queue[str] = asyncio.Queue()
    sse_queue: asyncio.Queue[str | None] = asyncio.Queue()

    # 入度为 0 的 Agent 先入队
    for agent_id, degree in in_degree.items():
        if degree == 0:
            await ready_queue.put(agent_id)

    # 4. 调度器协程
    async def scheduler():
        running = 0
        total = len(request.agents)
        done_count = 0

        while done_count < total:
            agent_id = await ready_queue.get()
            running += 1
            agent = next(a for a in request.agents if a.id == agent_id)

            # 构建上下文：把所有依赖 Agent 的输出拼入 prompt
            context_parts = []
            for dep_id in dependencies[agent_id]:
                dep_agent = next(a for a in request.agents if a.id == dep_id)
                if dep_id in agent_outputs:
                    context_parts.append(
                        f"## {dep_agent.name}（{dep_agent.role}）的分析：\n{agent_outputs[dep_id]}"
                    )

            asyncio.create_task(
                run_agent_with_context(agent, request.topic, context_parts, sse_queue,
                    on_done=lambda aid, text: handle_agent_done(aid, text))
            )

        async def handle_agent_done(agent_id: str, full_text: str):
            nonlocal done_count, running
            agent_outputs[agent_id] = full_text
            done_count += 1
            running -= 1

            # 检查哪些依赖我的 Agent 现在可以启动
            for next_id in dependents[agent_id]:
                in_degree[next_id] -= 1
                if in_degree[next_id] == 0:
                    await ready_queue.put(next_id)

            if done_count == total:
                await sse_queue.put(None)  # 结束信号

    asyncio.create_task(scheduler())

    # 5. 消费 SSE 队列
    while True:
        item = await sse_queue.get()
        if item is None:
            break
        yield item

    yield _sse({"type": "all_done"})
```

**注意事项**：
- 需要处理**环检测**：如果 edges 构成环，拓扑排序会死锁。建议在请求入口做 DFS 检测，有环则返回 400 错误。
- 没有 edges 的 Agent（孤立节点）视为入度 0，直接并行启动。
- 超时处理：每个 Agent 仍然保留 `AGENT_TIMEOUT_SECONDS = 120` 的超时。

### 4.3 前端改造（`page.tsx`）

**新增 props 传递**：`StepDeduction` 需要把 `edges` 传给推演请求

```typescript
// handleStartDeduction 里构造请求体时新增 edges
const edgesPayload = edges.map((e) => ({
  from: e.from,
  to: e.to,
  label: e.label,
}));

body: JSON.stringify({ topic, agents: agentsPayload, edges: edgesPayload })
```

**新增 SSE 事件处理**：

```typescript
} else if (evt.type === "round_start") {
  // 可以在星图上高亮当前轮次的节点
  setCurrentRound(evt.round);
} else if (evt.type === "agent_waiting") {
  // 节点显示「等待中」状态（可选，增强视觉）
  setNodes((prev) => prev.map((n) =>
    n.id === evt.agent_id ? { ...n, status: "waiting" as const } : n
  ));
}
```

**对话流 UI 改造**：按轮次分组展示

```tsx
// 在对话流面板中，按 round 分组
{rounds.map((round) => (
  <div key={round.number}>
    <div style={{ /* 分隔线 */ }}>── 第 {round.number} 轮 ──</div>
    {round.messages.map((msg) => <AgentMessageCard key={msg.agentId} msg={msg} />)}
  </div>
))}
```

**结果页（`StepResult`）改造**：
- 顶部新增「组织者综合结论」区域（流式输出，调用额外的 `/v1/summarize` 接口）
- 下方保留各 Agent 的最终输出卡片

### 4.4 新增接口：组织者汇总（可选，独立于方案 C）

```python
# POST /v1/summarize
# 推演完成后，把所有 Agent 的输出喂给组织者，生成综合结论
class SummarizeRequest(BaseModel):
    topic: str
    organizer: AgentDeductionConfig
    agent_outputs: list[dict]  # [{"name": "...", "role": "...", "text": "..."}]
```

---

## 五、实现顺序建议

```
Step 1：后端环检测工具函数（10 分钟）
Step 2：后端 graph_deduction_service.py 图调度器（核心，1-2 小时）
Step 3：后端新增 POST /v1/graph-deduction 路由（注册到 main.py）
Step 4：前端 handleStartDeduction 传入 edges（10 分钟）
Step 5：前端新增 round_start / agent_waiting 事件处理（30 分钟）
Step 6：前端对话流按轮次分组 UI（30 分钟）
Step 7：（可选）结果页组织者汇总区域
```

---

## 六、注意事项 & 踩坑记录

### 开发环境
- 前端：`cd frontend && npm run dev`（端口 3000）
- 后端：`docker compose up backend`（端口 8000）
- **后端改动后必须重建容器**：`docker compose build backend && docker compose up backend --force-recreate`

### React 规则
- **不能在 setState updater 函数里调用父组件的 setState**（会触发「Cannot update a component while rendering a different component」错误）
- 解决方案：用 `useRef` 暂存数据，在 `useEffect` 里统一触发

### 前端代码风格
- 所有样式用 inline style（`style={{ ... }}`），不用 Tailwind className
- 颜色变量：`var(--bg-primary)` / `var(--text-primary)` / `var(--text-secondary)` / `var(--text-muted)` / `var(--border-subtle)` / `var(--accent-blue)`
- 所有组件都在 `frontend/app/corwork/think-tank/page.tsx` 这一个文件里

### 后端代码风格
- SSE 事件格式：`f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"`
- 所有 Agent 调用用 `openai.AsyncOpenAI` + `create(stream=True)`（不用 `.stream()` 方法）
- 超时用 `asyncio.wait_for(coroutine, timeout=120)`

### API Key 匹配逻辑（前端）
```typescript
// 优先级：模型名精确匹配 → isActive → 第一个
const key =
  apiKeys.find((k) => k.modelName === model) ??
  apiKeys.find((k) => k.isActive) ??
  apiKeys[0];
```

---

## 七、给下一个对话的指令模板

可以直接把以下内容作为下一个对话的开头：

---

**请继续 Cor-AiWorker 项目的开发。**

项目是一个多 Agent 协作推演系统，技术栈：Next.js 15 + TypeScript（前端）+ FastAPI + Python（后端，Docker 运行）。

**当前状态**：Phase 3 推演阶段已完成基础版（各 Agent 并行独立输出）。

**下一步任务**：实现方案 C「图结构消息传递」——按组织阶段生成的 edges 有向图决定 Agent 之间的消息流向，让 Agent 真正能看到依赖 Agent 的输出后再生成自己的结论。

详细实现计划见 `docs/next-session-handoff.md`，请先读取该文件，然后从「Step 1：后端环检测工具函数」开始实现。

关键文件：
- `frontend/app/corwork/think-tank/page.tsx`（前端核心，2500+ 行）
- `backend/app/services/deduction_service.py`（当前并行推演实现）
- `backend/app/schemas/chat.py`（所有 Pydantic Schema）
- `backend/app/main.py`（路由注册）

---
