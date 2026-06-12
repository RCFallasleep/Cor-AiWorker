# Cor-AiWorker 迭代进度日志

> 项目名称：Cor-AiWorker
> 项目定位：基于多 Agent 协作的团队开发对齐系统
> 技术选型：Web 前端 Next.js 14 + React + TypeScript + Tailwind CSS + shadcn/ui / 后端 Python + FastAPI + LangChain（部分编排自实现）/ 客户端 Android（Compose，按需）

---

## 当前阶段：Phase 2-4 — Agent 养成系统

**状态**：进行中
**开始时间**：2026-06-12
**完成时间**：-

### 阶段说明

Agent 是整个协作系统的基础单元，后续的多 Agent 构建、协作交流（蜂巢）都依赖 Agent 库。
本阶段目标：建立完整的 Agent 定义、存储、管理体系，并将 Agent 接入聊天对话。

Agent 被视为一种**能力实体**，包含静态配置（基础信息）和动态评价（能力成长）两个维度。

### Phase 2-4 任务清单

#### 数据模型设计
- [ ] Agent 数据结构定义（前端 TypeScript 接口 + 后端 Pydantic Schema）
  - 基础信息（静态）：id / name / avatar / model / system_prompt / permission_level / tools
  - 能力评价（动态）：strengths / work_style / skill_scores（雷达图维度）/ team_tags
  - 成长轨迹（静态记录）：created_at / task_count / accuracy
  - 知识库储备：knowledge_docs（文档链接列表）
- [ ] Agent 本地持久化（IndexedDB，与会话存储同库）

#### 后端接口
- [ ] `GET /v1/agents/` — 查询 Agent 列表
- [ ] `POST /v1/agents/` — 创建 Agent
- [ ] `PUT /v1/agents/{agent_id}` — 更新 Agent 配置
- [ ] `DELETE /v1/agents/{agent_id}` — 删除 Agent
- [ ] Agent 接入聊天：`ChatRequest` 支持传入 `agent_id`，后端用对应 system prompt + 工具配置发起对话

#### 前端页面 — Agent 养成（`/health/agent`）
- [ ] Agent 列表视图（卡片式）：展示头像、名称、模型、能力标签
- [ ] Agent 详情/编辑页：
  - **基础信息**（静态）：名称、头像、模型选择、Prompt（任务描述）、权限等级、可调用工具
  - **能力评价**（动态）：能力擅长 + 工作风格标签、技能雷达图（编码/分析/创意/执行/沟通/速度）、所属 Agent 组队
  - **成长轨迹**（静态记录）：创建时间、完成任务次数、准确度
  - **知识库储备**：已关联文档列表（链接）、添加文档入口
- [ ] 新建 Agent 表单（快速创建）
- [ ] Agent 接入聊天页：顶部模型选择器支持切换到某个 Agent

#### 前端页面 — 多 Agent 构建（`/corwork/think-tank`）
- [ ] 从 Agent 库选择参与角色（替换当前硬编码的 4 个角色）
- [ ] 展示各 Agent 的真实配置信息（模型、擅长方向）

---

## 已完成阶段

### Phase 2-3 — Agent 质量优化 & 可观测性 ✅

**完成时间**：2026-06-12

#### Agent 行为质量
- [x] 搜索结果注入前提炼（`_extract_key_sentences`）：过滤废话句，优先保留含数字/日期/天气词的高密度句子
- [x] 搜索结果 token 压缩：结果条数 5→5（保持），每条摘要 300→120 字符，去掉 URL，压缩约 70%
- [x] 连续重复工具调用检测：同一工具连续调用 ≥2 次时，自动注入强制回答指令打断循环
- [x] 工具描述约束：明确"最多搜索 2 次"、"换关键词而非重复搜"等行为规范

#### 可观测性
- [x] `log_store.py`：三层数据模型（AgentRunLog / AgentRoundLog / ToolCallLog），SQLite 持久化（aiosqlite）
- [x] `agent_service.py` 集成日志：每轮记录耗时、token、finish_reason、思考文字、工具调用详情
- [x] `ChatRequest` 新增 `session_id` 字段，日志与前端会话关联
- [x] `/v1/logs/` 接口：列表查询（支持 session_id 筛选 + 分页）
- [x] `/v1/logs/{run_id}` 接口：单条详情（含完整 rounds）
- [x] 前端 `/settings/logs` 日志页面（列表 + 展开详情 + 工具调用节点）
- [x] `AgentFlowChart` 同名工具折叠（×N 徽章，可展开查看每次 query）
- [x] `main.py` lifespan 钩子，启动时 `init_db()` 初始化 SQLite
- [x] `docker-compose.yml` 挂载 `./data:/data`，SQLite 文件持久化到宿主机

---

## 已完成阶段

### Phase 2-2 — Agent 编排升级 & 任务流程图可视化 ✅

**完成时间**：2026-06-11

#### 后端流式编排升级
- [x] `agent_service.py` 每轮改用 `stream=True`，真正流式调用模型
- [x] 流式拼接 `tool_call` JSON（`tool_calls_acc` 字典按 index 逐步拼接 name + arguments）
- [x] 新增 `thinking_delta` SSE 事件：中间轮次思考文字实时推送
- [x] 新增 `reclassify` SSE 事件：模型先输出文字再输出 tool_call 时，通知前端把已渲染的 delta 移入思考区
- [x] 最终回复轮（finish_reason=stop）：文字已实时流式推完，直接推 done，无需二次处理
- [x] 去掉 `stream_options={"include_usage": True}`（DeepSeek 等模型不支持，导致流式失败）

#### 前端任务流程图可视化
- [x] `ChatMessage` 类型新增 `agentSteps: AgentStep[]` 字段，存储流程图数据
- [x] 新增 `AgentStep` 接口：`id / name / args / status / thinkingText / result`
- [x] 新建 `AgentFlowChart` 组件（`components/chat/agent-flow-chart.tsx`）：
  - 横向流程图布局，每个 tool_call = 一个阶段节点
  - 节点间箭头连接（横线 + 三角箭头）
  - 节点状态：running（旋转动画）/ done（绿勾）/ error（红叉）
  - 节点下方展示精简思考文字（最多 2 行，斜体）
  - 工具图标自动映射（web_search / browse / read_file / run_code 等）
  - 流式执行中显示"思考中"占位节点
  - 连续相同工具折叠为一个节点（`×N` 徽章），可展开查看每次 query
- [x] `MessageList` AI 气泡内渲染 `AgentFlowChart`（流程图在回复文字上方）
- [x] AI 气泡右上角收起/展开按钮（GitFork 图标）
- [x] `useChatStream` 新增 `onThinkingDelta` 回调 + `reclassify` 事件处理
- [x] `agentSteps` 持久化到 IndexedDB `MessageRow.meta.agentSteps`，切换会话后可恢复
- [x] Chat 页面重构：去掉底部工具调用状态条，`agentStepsRef` 实时镜像供 `onDone` 读取

---

### Phase 2-1 — 后端 Agent 引入 & Agent 自循环编排 ✅

**完成时间**：2026-06-11

#### 后端 Chat 调用建立
- [x] FastAPI 项目初始化（`backend/` 目录，Python + uvicorn，分层结构：api / services / schemas / tools / core）
- [x] `/v1/chat` 流式接口（SSE），将前端直连模型的调用迁移至后端，解决跨域问题
- [x] CORS 中间件配置（`allowed_origins` 环境变量驱动）
- [x] 前端 `useChatStream` 支持切换调用目标（`NEXT_PUBLIC_BACKEND_URL` 环境变量，未配置时回退内置路由）
- [x] 后端编码规范文档完善（`coding-standards/backend-standards.md`）

#### Function Calling 能力建设
- [x] Tool 注册表（`app/tools/registry.py`，符合 MCP 规范，支持动态注册/注销/执行，全局单例）
- [x] SearXNG 联网搜索工具（`app/tools/search.py`，HTTP GET 调用，结果格式化为模型易读文本，待实例就绪后自动生效）
- [x] Agent 自循环编排（`app/services/agent_service.py`，OpenAI 兼容协议）：
  - [x] 终止条件：模型不再输出 `tool_call` 时退出循环，流式推送最终回复
  - [x] 最大循环次数限制（`MAX_LOOP_COUNT = 10`，超出时强制终止并告知用户）
  - [x] 错误处理：工具调用失败时返回错误文本，模型可据此决策
- [x] `/v1/agent/chat` 独立路由（与 `/v1/chat` 并存，区分普通对话和 Agent 模式）
- [x] SSE 事件扩展：新增 `tool_call`（工具调用开始）和 `tool_result`（工具执行结果）事件类型

#### 前端 Agent 可视化（基础版）
- [x] `useChatStream` 扩展：新增 `onAgentEvent` 回调，处理 `tool_call` / `tool_result` 中间状态事件
- [x] `useChatStream` 支持 `agentMode` 参数，默认走 `/v1/agent/chat`
- [x] Chat 页面工具调用状态条：实时展示工具名称、参数、执行状态（旋转动画 → 完成勾）

#### 静态上下文注入
- [x] 后端 `ChatRequest` 新增 `context` 字段（`ClientContext`：timezone、city、latitude、longitude）
- [x] 后端 `_build_context_hint()` 统一构建 system 注入文本（当前时间实时生成 + 用户城市）
- [x] 前端 `useClientContext` Hook：自动获取 IANA 时区 + Geolocation 坐标反查城市（nominatim），结果缓存 6 小时到 localStorage
- [x] 前端每次请求携带 `context` 字段传给后端

#### Docker 部署
- [x] 后端 `Dockerfile`（python:3.12-alpine，含 gcc 编译依赖）
- [x] SearXNG `settings.yml` 自定义配置（开启 json 格式输出，关闭 limiter）
- [x] `docker-compose.yml`：backend + searxng 两服务编排，环境变量注入
- [x] 前端 `Dockerfile`（两阶段构建：node:20-alpine builder + runner，standalone 模式）
- [x] `docker-compose.yml` 新增前端服务（`profiles: [deploy]`，开发时不启动）
- [x] `README.md` 启动指南（本地开发模式 vs 全 Docker 部署模式）

---

### Phase 1-2 — Chat 聊天引入与 ChatAgent 编排 ✅

**完成时间**：2026-06-11

#### 消息展示与输入（多模态）
- [x] 消息展示：支持基础文字、图片、代码块样式渲染（react-markdown + react-syntax-highlighter）
- [x] 消息输入：支持文字、Word 文档、图片（多模态输入，含模型能力检测）

#### Chat UI
- [x] 顶部工具栏：会话选择器（替代 mock branch）+ 模型选择器 + 右侧工具按钮组
- [x] 新对话按钮（工具栏左侧）
- [x] AI 消息：Markdown 渲染、代码块高亮（语言标签 + Copy 按钮）、消息元信息栏（Token/ctx/模型标签/收藏/朗读/删除）
- [x] 用户消息：右对齐蓝色气泡 + 用户名 + 时间 + 头像
- [x] 底部输入框：多行自动扩展、附件菜单（图片/文档）、MCP/Skill 预留 `+` 插槽、Enter 发送

#### 数据持久化与兼容性
- [x] 前端 SQLite（sql.js + localStorage 持久化）接入 API Key 管理
- [x] API Key 管理页（/settings/apikey）：新增/编辑/删除/启用禁用/显示隐藏，支持 OpenAI/Anthropic/DeepSeek/Gemini/Custom
- [x] Repository 抽象层（IApiKeyRepository / IConversationRepository 接口，便于后续切换后端 API）
- [x] 聊天记录保存到本地（IndexedDB + idb 库）
- [x] 检测模型是否支持多模态（图片），不支持时隐藏图片输入入口

#### 接入真实 LLM
- [x] 从本地 SQLite 读取激活的 API Key，动态生成可用模型列表（useAvailableModels）
- [x] 调用 OpenAI 兼容协议 / Anthropic API（流式 SSE 输出，Edge Runtime Route Handler）
- [x] 替换 Chat 页面 Mock 回复为真实流式响应（useChatStream Hook）
- [x] Token 用量实时更新到消息元信息栏

#### 会话管理
- [x] 流式结束后异步调用 LLM 生成会话标题（8 字以内，不阻塞主对话）
- [x] 顶部下拉选择器切换历史会话，加载对应历史消息
- [x] Chat 页面读取 URL `?id=` 参数自动加载指定会话
- [x] 聊天记录历史页重构为表格式（Seal 风格）：会话名 / Agent / 预览 / 消息数 / 最后活跃 / 开始时间
- [x] 历史记录页顶部搜索框（客户端模糊匹配标题 + 预览）
- [x] 历史记录行操作：👁 查看详情 / ↗ 在聊天中打开 / 🗑 删除
- [x] `/chat/history/[id]` 只读详情页（Markdown 渲染 + 「在聊天中继续」按钮）

---

### Phase 1 — 前端 UI 框架搭建 ✅
**完成时间**：2026-06-10

- [x] 前端脚手架搭建（Next.js 14 App Router + TypeScript + Tailwind CSS）
- [x] 安装 UI 依赖（shadcn/ui、lucide-react）
- [x] 全局布局框架（侧边栏 + 顶部导航栏 + 内容区）
- [x] 侧边栏组件（分组导航、折叠动画、响应式自动折叠）
- [x] 顶部导航栏（面包屑导航、主题切换 Toggle、通知/设置图标）
- [x] 全局主题系统（暗色/亮色切换，CSS 变量驱动，平滑过渡动画）
- [x] 所有路由页面占位（/chat、/chat/history、/corwork、/workbench/* 等共 9 个路由）
- [x] 品牌图标设计（递归三层等边三角形 SVG，几何射线构造）
- [x] 响应式适配（窗口 < 900px 自动折叠侧边栏，< 600px 最小宽度保护）

### Phase 0 — 项目初始化 ✅
**完成时间**：2026-06-10

- [x] 确定技术选型
- [x] 创建项目基础目录结构（frontend/、backend/、android/、docs/、coding-standards/）
- [x] 创建 `.rules` 文件
- [x] 创建迭代进度日志
- [x] 创建产品 PRD 文档（v0.2，含完整功能模块说明）
- [x] 创建编码规范文件夹（UI 规范、后端规范占位）

---

## 后续规划

### Phase 2-4（当前）— Agent 养成系统
- Agent 数据模型 + 本地持久化
- Agent 养成页面（基础信息 / 能力评价 / 成长轨迹 / 知识库）
- Agent 接入聊天（顶部选择器切换 Agent）
- 多 Agent 构建页面接入真实 Agent 库

### Phase 3 — 多 Agent 构建（并行推演）
- 后端并行调用多个 Agent（不同 system prompt）
- 前端展示各 Agent 推演结果（分栏 / 时间线）
- 主导者对各 Agent 结论采纳 / 驳回

### Phase 4 — CorWork 协作交流（蜂巢）
- 多 Agent 群聊协作空间（基于 Agent 库）
- 需求拆解与任务分配流程
- 实时通信（WebSocket）

### Phase 5 — WorkBench 工作台
- 协作进度看板
- API 用量监控
- 定时任务配置与管理
- Skill / MCP 上传与管理

### Phase 6 — 开发者功能 & 实验功能
- 工作流可视化（MCP 积木搭建）
- 梦境归档系统

---

## 技术决策记录

| 日期 | 决策项 | 结论 | 备注 |
|------|--------|------|------|
| 2026-06-11 | 后端框架 | Python + FastAPI + LangChain，部分编排逻辑自实现 | 不完全依赖 LangChain Agent，核心循环自己控制 |
| 2026-06-11 | 联网搜索工具 | SearXNG 开源方案 | 已接入，Docker Compose 部署 |
| 2026-06-11 | 前端 Agent 可视化 | 暂缓，UI 方案待定 | Phase 2-1-1 后端稳定后再启动 |
| 2026-06-11 | Docker 镜像 | python:3.12-alpine（后端）/ node:20-alpine（前端） | slim 镜像国内拉取超时，alpine 体积小且镜像源有缓存 |
| 2026-06-11 | 静态上下文注入 | 时间由后端实时生成，位置由前端 Geolocation 获取后传入 | 避免模型用训练截止日期作为"今天" |
| 2026-06-11 | 环境变量格式 | pydantic-settings 解析 list[str] 需 JSON 数组格式 | `ALLOWED_ORIGINS=["url1","url2"]`，逗号分隔不被识别 |
| 2026-06-11 | Agent 日志存储 | 内存存储（最多 500 条），服务重启清空 | 当前阶段够用，Phase 2-3 接 SQLite 持久化 |
| 2026-06-12 | 搜索结果压缩策略 | 注入前提炼（规则提取高密度句），而非历史裁剪 | 历史裁剪会破坏 tool_call_id 对应关系导致 API 报错 |
| 2026-06-12 | 重复搜索打断 | 后端检测连续重复工具调用，注入强制回答 user 消息 | 工具描述约束对弱模型（Flash）无效，工程层兜底更可靠 |

---

## 变更记录

| 日期 | 阶段 | 内容 | 负责人 |
|------|------|------|--------|
| 2026-06-10 | Phase 0 | 项目初始化，创建基础目录结构与文档 | - |
| 2026-06-10 | Phase 1 | 前端脚手架搭建，完成整体 UI 框架、侧边栏、顶部导航、主题系统、品牌图标 | - |
| 2026-06-10 | Phase 1-2 | 规划 Chat 聊天引入与 ChatAgent 编排阶段，明确多模态输入输出、本地持久化、MCP 预留接口等任务 | - |
| 2026-06-10 | Phase 1-2 | Chat UI 完成：消息列表（Markdown+代码块）、用户气泡、元信息栏、顶部工具栏、底部多模态输入框 | - |
| 2026-06-10 | Phase 1-2 | API Key 管理页完成：sql.js 本地 SQLite、Repository 抽象层、CRUD UI（新增/编辑/删除/启用/显示隐藏） | - |
| 2026-06-10 | Phase 1-2 | 真实 LLM 接入完成：流式 SSE Route Handler、useChatStream Hook、useAvailableModels 动态模型列表 | - |
| 2026-06-10 | Phase 1-2 | API Key 体验优化：去掉 Provider 下拉，3 字段极简表单，协议自动识别（sk-ant-* → Anthropic） | - |
| 2026-06-10 | Phase 1-2 | Chat UI 细节优化：输入框高度动态扩展、AI 等待三点跳动动画、AI 气泡 fit-content 宽度（最宽 80%） | - |
| 2026-06-10 | Phase 1-2 | 聊天记录持久化：IndexedDB（idb）存储会话+消息，Repository 抽象层，/chat/history 历史列表页 | - |
| 2026-06-11 | Phase 1-2 | 会话管理完善：LLM 异步生成标题、顶部下拉切换会话、URL ?id= 参数自动加载 | - |
| 2026-06-11 | Phase 1-2 | 历史记录页重构：表格式布局（Seal 风格）、搜索框、Agent 列占位、操作按钮组 | - |
| 2026-06-11 | Phase 1-2 | 新增 /chat/history/[id] 只读详情页，支持 Markdown 渲染与「在聊天中继续」跳转 | - |
| 2026-06-11 | Phase 1-2 | Phase 1-2 全部完成，进入 Phase 2-1 规划 | - |
| 2026-06-11 | Phase 2-1 | 规划后端 Agent 引入阶段：FastAPI + LangChain（部分编排自实现），联网搜索暂缓（SearXNG 方案），前端可视化暂缓 | - |
| 2026-06-11 | Phase 2-1 | 完善后端编码规范（分层规范、SSE 事件格式、Agent 循环规范、日志规范） | - |
| 2026-06-11 | Phase 2-1 | FastAPI 后端骨架搭建：app/api/v1/chat、app/services/chat_service、app/schemas/chat、app/tools/registry、app/core/config+cors | - |
| 2026-06-11 | Phase 2-1 | /v1/chat 流式 SSE 接口实现，支持 OpenAI 兼容协议 + Anthropic 双协议自动识别 | - |
| 2026-06-11 | Phase 2-1 | 前端 useChatStream 改造：支持 NEXT_PUBLIC_BACKEND_URL 环境变量切换后端，兼容 snake_case/camelCase 双格式 | - |
| 2026-06-11 | Phase 2-1 | SearXNG 联网搜索工具实现（HTTP GET，结果格式化），Tool 注册表完善，工具启动时自动注册 | - |
| 2026-06-11 | Phase 2-1 | Agent 自循环编排完成：/v1/agent/chat 路由，MAX_LOOP_COUNT=10，tool_call/tool_result SSE 事件 | - |
| 2026-06-11 | Phase 2-1 | 前端 useChatStream 扩展 agentMode + onAgentEvent 回调；Chat 页面工具调用状态条 UI | - |
| 2026-06-11 | Phase 2-1 | 静态上下文注入：useClientContext Hook（时区+城市），后端 _build_context_hint()，ChatRequest.context 字段 | - |
| 2026-06-11 | Phase 2-1 | Docker 部署：后端 Dockerfile、SearXNG settings.yml、docker-compose.yml（backend+searxng+frontend） | - |
| 2026-06-11 | Phase 2-2 | 后端 agent_service 改为每轮 stream=True，流式拼接 tool_call JSON，新增 thinking_delta / reclassify SSE 事件 | - |
| 2026-06-11 | Phase 2-2 | 前端 AgentFlowChart 横向流程图组件：工具调用从底部状态条移入 AI 气泡，每步一个节点含思考文字 | - |
| 2026-06-11 | Phase 2-2 | ChatMessage 新增 agentSteps 字段；agentSteps 持久化到 IndexedDB meta；Chat 页面重构 Agent 事件处理 | - |
| 2026-06-11 | Phase 2-2 | AI 气泡右上角收起/展开按钮；AgentFlowChart 同名工具折叠（×N 徽章，可展开查看每次 query） | - |
| 2026-06-11 | Phase 2-2 | Phase 2-2 完成，进入 Phase 2-3 规划 | - |
| 2026-06-11 | Phase 2-3 | LLM 行为分析日志系统：log_store.py 三层数据模型，agent_service 集成日志，/v1/logs/ 接口，前端日志页面 | - |
| 2026-06-12 | Phase 2-3 | 搜索结果注入前提炼：_extract_key_sentences() 过滤废话、优先高密度句，每条摘要压缩至 120 字符 | - |
| 2026-06-12 | Phase 2-3 | 连续重复工具调用检测：同一工具连续调用 ≥2 次时注入强制回答指令，防止 Flash 模型无限循环 | - |
| 2026-06-12 | Phase 2-3 | ChatRequest 新增 session_id 字段，前端传入 convId，日志与会话关联；/v1/logs 路由注册 | - |
| 2026-06-12 | Phase 2-3 | log_store.py 改造为 SQLite 持久化（aiosqlite），main.py lifespan 钩子，docker-compose 挂载 ./data:/data | - |
| 2026-06-12 | Phase 2-3 | Phase 2-3 完成，进入 Phase 2-4 Agent 养成系统规划 | - |
| 2026-06-12 | Phase 2-4 | 侧边栏"协作"分组新增「多 Agent 构建」入口（/corwork/think-tank），占位页面上线 | - |
| 2026-06-12 | Phase 2-4 | 确定 Agent 数据模型四个维度：基础信息（静态）/ 能力评价（动态）/ 成长轨迹 / 知识库储备 | - |
