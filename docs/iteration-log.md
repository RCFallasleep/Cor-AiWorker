# Cor-AiWorker 迭代进度日志

> 项目名称：Cor-AiWorker
> 项目定位：基于多 Agent 协作的团队开发对齐系统
> 技术选型：Web 前端 Next.js 15 + React + TypeScript / 后端 Python + FastAPI（编排自实现）/ 客户端 Android（Compose，按需）

---

## 当前阶段：Phase 4 — MCP/Skill 建设 & 多模态 Chat

**状态**：已完成（Skills 看板 + 多模态图片输入 + 粘贴截图）
**开始时间**：2026-06-15
**最后更新**：2026-06-15

### 阶段说明

在 Phase 3 多 Agent 推演能力的基础上，本阶段完成两条主线：
1. **Skills 看板**：后端 SQLite 持久化 + CRUD API，前端仓库风格预览弹窗，内置 Skill 种子数据自动同步
2. **多模态 Chat**：根据模型 `supportsVision` 字段动态开关图片上传，支持 OpenAI/Anthropic/Bedrock 三种协议的多模态格式转换，以及系统截图/QQ/微信截图直接粘贴

### Phase 4 任务清单

#### 后端 — Skills 持久化与 API（已完成）
- [x] `skill_store.py`：SQLite 两张表（`skills` + `skill_files`），完整 CRUD + 文件 upsert + 语言自动识别 + GitHub 风格构成比例计算
- [x] `_BUILTIN_SKILLS` 列表：内置 Skill 定义（含完整真实代码，如 `search.py` 150 行）
- [x] `seed_builtin_skills()`：幂等初始化，已存在则只同步文件内容，不改元数据
- [x] `skills.py` 路由：`GET/POST /v1/skills`、`GET/PATCH/DELETE /v1/skills/{id}`、`PUT /v1/skills/{id}/files`、`POST /v1/skills/{id}/files/upload`（multipart）
- [x] PATCH 时若 `enabled` 变化，动态注册/注销 `tool_registry`
- [x] `skill_runner.py`：`register_skill_as_tool()` exec 用户 .py 文件，AST 提取参数 schema，注册到 tool_registry；`load_enabled_skills()` 启动时批量加载
- [x] `main.py` 启动时调用 `seed_builtin_skills()` + `load_enabled_skills()`
- [x] `requirements.txt` 新增 `python-multipart==0.0.20`（文件上传依赖）

#### 后端 — 多模态消息 Schema（已完成）
- [x] `schemas/chat.py` 新增 `TextPart` / `ImageUrlPart` / `ImageUrlDetail` Pydantic 模型
- [x] `MessageContent = Union[str, list[Union[TextPart, ImageUrlPart]]]`，`Message.content` 支持多模态
- [x] `chat_service.py` `_to_openai_messages()`：多模态 part 列表直接序列化
- [x] `chat_service.py` `_to_anthropic_content()`：base64 data URL → Anthropic `image/source/base64` 格式；外部 URL → Anthropic `url source` 格式

#### 前端 — Skills 看板（已完成）
- [x] `workbench/skills/page.tsx` 全量重写
  - `SkillCard`：卡片组件，含 GitHub 风格构成进度条、标签、启用/禁用开关、删除
  - `CompositionBar`：彩色分段进度条 + 图例（按语言着色）
  - `PreviewModal`：**仓库风格**弹窗，默认显示文件列表（文件夹图标 + 文件行 + 文件大小），点击文件进入内容视图，面包屑导航，Esc 返回，底部始终显示构成进度条
  - `CreateSkillModal`：新建 Skill 表单，支持多文件编辑器 + 文件上传
  - 主页面：搜索框 + 全部/内置/自建筛选 + 响应式网格

#### 前端 — 多模态 Chat（已完成）
- [x] `use-chat-stream.ts` 新增 `ImageAttachment` 接口 + `Attachment` 联合类型
- [x] `buildUserContent()`：图片附件 → `{type:"image_url", image_url:{url, detail:"auto"}}` OpenAI vision 格式
- [x] `buildRequestBody()` 新增 `attachments` 参数，替换最后一条 user 消息的 content 为多模态格式
- [x] `chat/page.tsx` `handleSend` 接收 `attachments`，图片 base64 存入 `meta.imagePreviews`，传给 `sendMessage`
- [x] `message-list.tsx` 用户消息气泡上方渲染图片缩略图（80×80，点击新标签页全屏查看），纯图片消息不渲染空文字气泡
- [x] `chat-input.tsx` 新增 `handlePaste` 处理器，挂载到 textarea `onPaste`，支持系统截图和 QQ/微信截图直接粘贴（`ClipboardEvent.items` 过滤 `image/*`，`FileReader.readAsDataURL` 转 base64）
- [x] `models-config.ts` 按模型配置 `supportsVision` 字段，控制图片上传入口显示/隐藏

#### 技术亮点
- **Skill 动态注册**：`skill_runner.py` 将用户自建 Skill 的 `.py` 文件 `exec` 后注册到 `tool_registry`，工具名格式 `skill_{snake_case_name}`，无需重启服务
- **种子数据同步策略**：每次启动 `seed_builtin_skills()` 按名称查找已有内置 Skill，只 upsert 文件内容，不改元数据（幂等）
- **三协议多模态**：同一套前端附件格式，后端按 `provider` 字段自动转换为 OpenAI / Anthropic / Bedrock 各自的多模态消息格式
- **粘贴截图零配置**：`ClipboardEvent API` 拦截剪贴板图片，`FileReader` 转 base64，与文件上传走同一套附件流程

---

### Phase 3 任务清单

#### 后端 — 组织阶段（已完成）
- [x] `organize_service.py`：4 个 Prompt 模版 + 流式 LLM 调用 + JSON 解析
- [x] `POST /v1/organize`：SSE 流式接口（thinking_delta / done / error 事件）
- [x] `GET /v1/organize/templates`：返回内置模版列表
- [x] `OrganizeRequest / OrganizeRole / OrganizeEdge / OrganizeResult` Pydantic Schema

#### 后端 — 图推演阶段（已完成）
- [x] `graph_deduction_service.py`：`asyncio` 并行启动多个 Agent 协程，拓扑排序依赖调度
- [x] `POST /v1/deduction`：SSE 流式接口，每条事件携带 `agent_id`，前端按 id 分流渲染
- [x] 并发限制与超时：单个 Agent 超时（120s）不影响其他 Agent 继续输出
- [x] SSE 事件：`agent_waiting` / `agent_start` / `delta` / `agent_done` / `agent_error` / `all_done`

#### 后端 — 研讨会模式（已完成）
- [x] `discussion_service.py`：动态多轮研讨会调度器
  - 每轮所有普通 Agent 并行发言（Round 1 独立观点，Round N 基于前轮回应）
  - 每轮结束后组织者做「裁判」判断（非流式，低温度 0.2，`response_format: json_object`）
  - 组织者决定是否继续下一轮，最多 `MAX_ROUNDS=5` 轮防止无限循环
  - 最终组织者流式输出综合总结报告
- [x] `POST /v1/discussion`：SSE 流式接口
- [x] 新增 SSE 事件：`organizer_decision`（携带 `continue: bool` + `reason` 裁判理由）

#### 前端 — `/corwork/think-tank` 页面（已完成）
- [x] 整体架构：4 步 ViewPager（组建团队 → 提出议题 → 并行推演 → 结果产出）
- [x] 顶部 TopBar：进度条 + 存档按钮（带数量徽章）
- [x] 第 1 步 `StepTeam`：从 `agentRepo` 读取真实 Agent，卡片勾选，支持设置组织者（金色皇冠标识）
- [x] 第 2 步 `StepTopic`：议题输入框，支持快捷议题模板
- [x] 第 3 步 `StepDeduction`：星图（Mesh 网状）可视化主界面
  - [x] 深色宇宙背景（径向渐变）+ `StarField` 星点闪烁动画
  - [x] `MeshCanvas`：Canvas 绘制渐变连线 + **实时 token 信息流粒子**（彗星拖尾效果）
    - 粒子完全脱离 React state，用 `ref` 管理，rAF 循环内直接操作，零 re-render
    - token 速率越快粒子越多越大（每 10 字符 1 颗，最多 3 颗/次，大小 1.5~3.5px）
    - 研讨会 Round 2 时粒子定向飞向组织者（汇聚效果）
    - 组织者总结阶段所有节点向组织者汇聚
    - 推演阶段隔离：仅 `deductPhase === "running"` 时生成粒子
  - [x] `MeshNode`：圆形 Agent 节点，颜色加强，发光效果，状态指示点
  - [x] 组织者节点：金色皇冠 + 脉冲光环（`pulse-ring` 动画）
  - [x] 节点拖拽：`document` 级 `mousemove`/`mouseup` 监听，支持跨区域拖拽不中断
  - [x] 节点拖回 Dock：拖到底部 Dock 区域松手自动移除，Dock 红色高亮提示
  - [x] 底部 `AgentDock`：横向卡片，可收起，点击加入星图，HTML5 drag 拖入星图定位
  - [x] 对话日志面板：右侧滑出，按轮次分组展示，支持按 Agent 过滤
  - [x] 组织阶段 UI：左侧面板（组织者信息 + 快速模版 + Prompt 编辑区 + 实时 thinking 流）
  - [x] 星图有向连线：组织完成后绘制带箭头的有向边，节点显示职位胶囊标签
  - [x] `NodeDetailPanel`：组织完成后点击节点弹出右侧抽屉，职位/任务 Prompt/汇报对象可编辑
  - [x] **推演模式切换**：「图推演」vs「研讨会」模式选择按钮
  - [x] **研讨会对话流 UI**：
    - 按轮次动态分组（第一轮·初步发言 / 第二轮·深化讨论 / ...）
    - 每轮结束后展示**组织者裁判决策卡片**（蓝色「继续下一轮」/ 金色「讨论充分，进入总结」+ 一句话理由）
    - 组织者综合总结金色特殊展示区块（流式输出 + 光标闪烁）
  - [x] **存档系统**：推演完成自动保存到 `localStorage`（最多 20 条），`SessionListPanel` 历史侧边栏，点击存档跳转结果页
- [x] 第 4 步 `StepResult`：结果产出页
  - [x] 图推演模式：所有 Agent 结论卡片网格展示
  - [x] 研讨会模式：只展示组织者综合总结大卡片 + 参与 Agent 小标签列表
  - [x] `DeductionResult` 接口：统一携带 `msgs` / `mode` / `organizerSummary`

#### 技术亮点
- **粒子系统零 re-render**：粒子数据完全用 `useRef` 管理，Canvas rAF 循环直接读写，彻底避免每帧 `setState` 卡死页面
- **组织者自主裁判**：每轮结束后组织者 Agent 非流式调用判断是否继续，动态决定轮数（最多 5 轮）
- **pendingDoneRef 模式**：避免在 React setState updater 内调用父组件 setState 的规范解法

---

## 已完成阶段

### Phase 3 — 多 Agent 并行推演 ✅

**完成时间**：2026-06-15

（详见上方 Phase 3 任务清单）

---

### Phase 2-4 — Agent 养成系统 ✅

**完成时间**：2026-06-12

#### 数据模型设计
- [x] Agent 数据结构定义（前端 TypeScript 接口）
  - 基础信息（静态）：id / name / iconName / iconColor / model / systemPrompt / permissionLevel / tools
  - 能力评价（动态）：workStyle / skillScores（六维雷达图）/ tags
  - 成长轨迹（静态记录）：createdAt / taskCount / accuracy / teamCount / level
  - 知识库储备：knowledgeDocs（文档链接列表）
- [x] Agent 本地持久化（IndexedDB v4，agents store）
- [x] `agent-repository.ts`：CRUD 封装 + `calcLevel()` 等级计算

#### LiveBench 数据接入
- [x] `livebench_service.py`：内嵌静态 CSV（2026-01-08，124 个模型），50+ 别名映射，7 层模糊匹配
- [x] `GET /v1/livebench/scores?model=xxx`：返回六维分数（支持模糊匹配）
- [x] `GET /v1/livebench/models`：返回所有可用模型列表
- [x] `POST /v1/livebench/refresh`：强制刷新缓存
- [x] 前端新建 Agent 时，选择模型后自动查询 LiveBench 并预览六维分数
- [x] 创建 Agent 时将真实 LiveBench 分数写入 skillScores

#### 前端页面 — Agent 养成（`/health/agent`）
- [x] Agent 列表视图（卡片式）：图标 + 名称 + 模型 + 能力标签 + Lv 进度条 + 三项统计
- [x] Agent 详情面板（右侧滑出）：四 Tab（身份/能力/战绩/知识库）
- [x] 能力 Tab：SVG 雷达图 + 各维度进度条 + LiveBench 数据来源标注
- [x] 新建 Agent 表单：图标/颜色选择 + 模型选择 + LiveBench 实时预览 + 工作风格/Prompt/标签/工具
- [x] 移除 Mock 数据种子，`MOCK_AGENTS` 清空，Agent 数据完全由用户创建
- [x] Agent 删除：卡片 hover 显示垃圾桶按钮 + `DeleteConfirmDialog` 二次确认
- [x] Agent 详情面板编辑模式：身份 Tab 点击铅笔图标进入编辑，支持修改名称/角色/工作风格/System Prompt/标签/工具，保存后实时同步 IndexedDB 和卡片列表

#### 前端页面 — 聊天接入
- [x] `ChatToolbar`：`ModelSelector` → `AgentSelector`，从 `agentRepo` 读取真实 Agent 列表
- [x] System Prompt 注入：`useChatStream.sendMessage` 支持 `systemPrompt?` 参数，自动插入 system 消息
- [x] 会话关联 Agent：`ConversationRow` 新增 `agentId` / `agentName`（DB v4），创建会话时写入
- [x] 历史页 AGENT 列：有 `agentName` 显示紫色标签，否则显示旧模型名（向后兼容）
- [x] Agent 选择持久化：`localStorage` key `cor_last_agent_id`，刷新/重开页面自动恢复
- [x] 对话持久化：`localStorage` key `cor_last_conv_id`，刷新/重开页面自动恢复上次对话
- [x] 切换历史对话自动恢复 Agent：`handleConversationChange` 读取 `ConversationRow.agentId`，URL `?id=` 跳转同样生效

#### 延后需求
- [ ] 对话完成后自动更新 taskCount，等级随之成长（延后至 Phase 4）

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

### Phase 4（当前）— MCP/Skill 建设 & 多模态 Chat（已完成，收尾待做）
- [x] Skills 看板：后端 CRUD + SQLite 持久化 + 前端仓库风格预览弹窗
- [x] 多模态 Chat：图片上传 + 粘贴截图 + 三协议格式转换
- [ ] Skills 看板编辑功能（当前只有新建和删除，缺少编辑已有 Skill 文件的入口）
- [ ] 文档上传解析（`.pdf/.docx` 读取内容作为 Agent 上下文，当前只存文件名）
- [ ] 存档系统：支持从历史存档恢复研讨会模式（当前恢复时 mode 固定为 "graph"）
- [ ] Think Tank 导出报告功能（当前按钮 disabled 占位）

### Phase 5 — CorWork 协作交流（蜂巢）
- 多 Agent 群聊协作空间（基于 Agent 库）
- 需求拆解与任务分配流程
- 实时通信（WebSocket）

### Phase 6 — WorkBench 工作台进阶
- 协作进度看板
- API 用量监控
- 定时任务配置与管理

### Phase 7 — 开发者功能 & 实验功能
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
| 2026-06-15 | Skill 动态注册 | exec 用户 .py 文件 + AST 提取参数 schema，注册到 tool_registry | 无需重启服务，PATCH enabled 时实时注册/注销 |
| 2026-06-15 | 种子数据同步 | 每次启动按名称 upsert 文件内容，不改元数据（幂等） | 避免重复创建，同时保证代码更新后自动同步到 DB |
| 2026-06-15 | 多模态消息格式 | 前端统一用 OpenAI vision 格式，后端按 provider 转换为各协议格式 | 前端无需感知协议差异，转换逻辑集中在 chat_service |
| 2026-06-15 | 粘贴截图方案 | ClipboardEvent.items 过滤 image/*，FileReader 转 base64 | 与文件上传走同一套附件流程，零额外状态管理 |

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
| 2026-06-12 | Phase 2-4 | LiveBench 接入：内嵌静态 CSV（124 模型）+ 50+ 别名映射 + 7 层模糊匹配，解决全 50 分问题 | - |
| 2026-06-12 | Phase 2-4 | Agent 管理页：移除 Mock 种子数据，新增删除功能（hover 垃圾桶 + 二次确认 Dialog） | - |
| 2026-06-12 | Phase 2-4 | Agent 接入聊天：AgentSelector 替代 ModelSelector，System Prompt 注入，会话关联 agentId/agentName（DB v4） | - |
| 2026-06-12 | Phase 2-4 | 持久化优化：localStorage 存储上次选中 Agent（cor_last_agent_id）和上次对话（cor_last_conv_id），刷新自动恢复 | - |
| 2026-06-12 | Phase 2-4 | Agent 详情面板编辑模式：身份 Tab 铅笔按钮进入编辑，支持修改名称/角色/工作风格/Prompt/标签/工具，保存写入 IndexedDB | - |
| 2026-06-12 | Phase 2-4 | 切换历史对话自动恢复 Agent：handleConversationChange 读取 ConversationRow.agentId，URL ?id= 跳转同样生效 | - |
| 2026-06-12 | Phase 2-4 | Phase 2-4 全部完成，进入 Phase 3 多 Agent 并行推演规划 | - |
| 2026-06-14 | Phase 3 | think-tank 页面全量重写：4 步 ViewPager + TopBar 进度条合并，StepTeam/StepTopic/StepResult 占位完成 | - |
| 2026-06-14 | Phase 3 | StepDeduction 星图主界面：深色宇宙背景 + StarField 星点 + MeshCanvas 渐变连线 + 粒子流动动画 | - |
| 2026-06-14 | Phase 3 | MeshNode 节点：圆形 + 颜色加强 + 发光效果 + 状态指示点 + 组织者皇冠/脉冲光环 | - |
| 2026-06-14 | Phase 3 | AgentDock：横向卡片 + 可收起 + HTML5 drag 拖入星图 + 点击加入；对话日志面板右侧滑出 | - |
| 2026-06-14 | Phase 3 | Bug 修复：initializedRef 防 resize 重置节点；undefined 对话兜底；节点颜色太淡加强 | - |
| 2026-06-14 | Phase 3 | 节点拖回 Dock：document 级 mousemove/mouseup 监听，跨区域拖拽不中断，Dock 红色高亮提示 | - |
| 2026-06-14 | Phase 3 | 组织阶段实现：后端 organize_service.py + /v1/organize SSE 接口 + /v1/organize/templates 模版接口 | - |
| 2026-06-14 | Phase 3 | 组织阶段前端：左侧面板（组织者信息 + 快速模版 + Prompt 编辑区）+ 实时 thinking 流 + 组织完成状态机 | - |
| 2026-06-14 | Phase 3 | 星图有向连线：组织完成后 MeshCanvas 绘制带箭头+label 的有向边，节点显示职位胶囊标签 | - |
| 2026-06-14 | Phase 3 | NodeDetailPanel：组织完成后点击节点弹出右侧抽屉，显示职位/任务 Prompt/汇报对象，支持编辑保存 | - |
| 2026-06-14 | Phase 3 | API Key 自动匹配：删除 UI 选择器，按组织者模型名精确匹配 → isActive → 第一个 key 的优先级自动选取 | - |
| 2026-06-14 | Phase 3 | Bug 修复：Docker 容器未重建导致 404（需 build + force-recreate）；AsyncOpenAI 不支持 .stream() 改为 create(stream=True) | - |
| 2026-06-15 | Phase 3 | 存档系统：SessionRecord 数据结构 + SessionListPanel 历史侧边栏 + TopBar 存档按钮（带数量徽章）+ 推演完成自动保存 | - |
| 2026-06-15 | Phase 3 | 研讨会模式（Discussion Mode）：discussion_service.py 三阶段流程 + POST /v1/discussion SSE 接口 | - |
| 2026-06-15 | Phase 3 | 研讨会前端：deductMode 切换按钮 + 对话流按轮次分组展示 + 组织者总结金色特殊区块 | - |
| 2026-06-15 | Phase 3 | Bug 修复：React key 重复（改为 agentId-round 组合 key）；StepResult 研讨会模式只展示组织者总结 | - |
| 2026-06-15 | Phase 3 | 数据流重构：onDeductDone 回调改为 DeductionResult（含 msgs/mode/organizerSummary），ThinkTankPage state 类型更新 | - |
| 2026-06-15 | Phase 3 | 实时 token 信息流粒子：粒子完全脱离 React state 用 ref 管理，token 速率驱动粒子密度/大小，彗星拖尾效果 | - |
| 2026-06-15 | Phase 3 | 粒子系统性能修复：移除 setParticles rAF 循环（每帧 setState 卡死页面），改为 Canvas rAF 直接操作 ref，零 re-render | - |
| 2026-06-15 | Phase 3 | 粒子阶段隔离：仅 deductPhase==="running" 时生成粒子，组织阶段不产生粒子 | - |
| 2026-06-15 | Phase 3 | 组织者自主裁判：每轮结束后组织者 Agent 判断是否继续（JSON decision），动态轮数（最多 5 轮） | - |
| 2026-06-15 | Phase 3 | 裁判决策 UI：每轮消息列表下方展示组织者决策卡片（蓝色继续/金色结束 + 一句话理由） | - |
| 2026-06-15 | Phase 3 | 多轮通用化：Round N（N>2）消息初始化改为通用逻辑，不再硬编码 Round 2，轮次标签动态化 | - |
| 2026-06-15 | Phase 4 | Skills 后端：skill_store.py（SQLite 两表 CRUD）+ skills.py 路由（CRUD + 文件上传）+ skill_runner.py（动态注册工具） | - |
| 2026-06-15 | Phase 4 | Skills 种子数据：_BUILTIN_SKILLS 含完整真实代码（search.py 150 行），seed_builtin_skills() 幂等同步，启动时自动执行 | - |
| 2026-06-15 | Phase 4 | Skills 前端看板：SkillCard + CompositionBar（GitHub 风格构成进度条）+ PreviewModal（仓库文件树风格）+ CreateSkillModal | - |
| 2026-06-15 | Phase 4 | 多模态 Schema：TextPart / ImageUrlPart Pydantic 模型，MessageContent 支持 str | list，chat_service 三协议格式转换 | - |
| 2026-06-15 | Phase 4 | 多模态前端：use-chat-stream buildUserContent() 转 OpenAI vision 格式，chat/page.tsx 传 attachments，MessageList 渲染缩略图 | - |
| 2026-06-15 | Phase 4 | 粘贴截图：chat-input.tsx handlePaste 处理器，ClipboardEvent 过滤 image/*，FileReader 转 base64，挂载到 textarea onPaste | - |
