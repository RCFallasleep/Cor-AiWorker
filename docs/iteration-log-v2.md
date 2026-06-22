# Cor-AiWorker 迭代进度日志 · v2

> 本文档记录 Phase 8 及后续的小功能迭代，主文档见 [iteration-log.md](./iteration-log.md)
>
> 项目名称：Cor-AiWorker
> 项目定位：基于多 Agent 协作的团队开发对齐系统
> 技术选型：Web 前端 Next.js 15 + React + TypeScript / 后端 Python + FastAPI / 客户端 Android（Jetpack Compose）/ AS 插件（IntelliJ Platform）

---

## 待办 Backlog

> 从主文档迁移的遗留待办项，按优先级排列。

### 体验补全（遗留）
- [ ] Skills 看板编辑功能（当前只有新建和删除，缺少编辑已有 Skill 文件的入口）
- [ ] Think Tank 导出报告功能（当前按钮 disabled 占位）
- [ ] 存档系统：支持从历史存档恢复研讨会模式（当前恢复时 mode 固定为 "graph"）
- [ ] 消息页加载更多历史消息（上拉分页）
- [ ] 公共记忆（ComMemory）管理入口（新建 / 编辑 / 删除）

### 断点调试深化
- [ ] Agent 主动建议修复：断点命中后自动分析变量异常，直接给出修复代码并写入文件
- [ ] 多断点对比分析：对比两次快照的变量变化，定位问题根因
- [ ] 断点历史回放：时间轴 UI，回放最近 20 条快照

### 协作看板
- [ ] 项目看板：Kanban 风格，任务卡片拖拽，关联 Agent 自动更新状态
- [ ] Android 端：好友申请通知、项目 Tab、协作看板 Tab

### 计划中功能
- [x] **聊天框可视化渲染**（Phase 8.4）：Agent 输出 ECharts/Mermaid/SVG/HTML 代码块，聊天框内沙箱渲染为可交互图表（已完成）
- [x] **聊天驱动定时任务**（Phase 8.5）：用户在聊天中说"提醒我…"，Agent 自动创建定时任务；工作台展示任务列表、执行记录、结果详情（MVP 已完成）
- [x] **上下文感知与自动管理**（Phase 8.6）：上下文占用可视化（进度条 + 百分比）、超限预警（80%/95% 分级）、智能摘要压缩（LLM 压缩 + 两层触发 + 手动压缩）（已完成）

---

## Phase 8 — 功能迭代（进行中）

**状态**：进行中
**开始时间**：2026-06-18
**最后更新**：2026-06-23（Phase 8.6 完成）

---

## 变更记录

| 日期 | 模块 | 内容 | 负责人 |
|------|------|------|--------|
| 2026-06-22 | 前端 | Bugfix：chart-preview.tsx ECharts option 解析三级 fallback（JSON.parse → eval → new Function），修复 AI 输出纯 JSON 时渲染失败的问题 | - |
| 2026-06-23 | 后端 | Phase 8.6 上下文管理：新增 MODEL_CONTEXT_LIMITS 映射表（30+ 模型），_get_context_limit() 前缀匹配，done 事件新增 context_limit 字段 | - |
| 2026-06-23 | 后端 | Phase 8.6 上下文管理：新增 _compress_messages()（LLM 智能摘要，max_tokens=1000，失败降级截断），两层触发（90% 主动 + BadRequestError 被动），compress_only 手动压缩模式 | - |
| 2026-06-23 | 后端 | Phase 8.6 上下文管理：ChatRequest 新增 compress_only 字段；compressing / compress_done 两个 SSE 事件类型 | - |
| 2026-06-23 | 前端 | Phase 8.6 上下文管理：use-chat-stream.ts 新增 CompressingEvent / CompressDoneEvent 接口，onDone 新增 contextLimit 参数，SSE 路由处理压缩事件 | - |
| 2026-06-23 | 前端 | Phase 8.6 上下文管理：chat/page.tsx 维护 totalInputTokens / contextLimit / isCompressing state，handleManualCompress 手动压缩回调，onDone 累计 token 并计算 ctxUsagePercent | - |
| 2026-06-23 | 前端 | Phase 8.6 上下文管理：chat-toolbar.tsx 新增 ContextBar 组件（进度条 + 百分比 + token 数 + 手动压缩按钮），颜色三段（绿/黄/红） | - |
| 2026-06-23 | 前端 | Phase 8.6 上下文管理：agent-flow-chart.tsx 新增 CompressingNode（紫色主题，可展开查看压缩消息摘要列表） | - |
| 2026-06-23 | 前端 | Phase 8.6 上下文管理：message-list.tsx MessageMeta ctxPercent 颜色随占用变化（70%+ 黄色，90%+ 红色） | - |
| 2026-06-23 | 前端 | Phase 8.6 上下文管理：chat-input.tsx 新增 80%/95% 预警横幅（黄色提示 / 红色 + 开启新对话按钮） | - |
| 2026-06-18 | 文档 | 新建 v2 迭代子文档，与主文档建立链接 | - |
| 2026-06-21 | 工具 | 新增 BrowserRead 工具：真实浏览器读取网页，突破反爬限制 | - |
| 2026-06-21 | Agent | 修复流式渲染文字消失 Bug：后端改为缓冲策略（pre_tool_buf），彻底消除 reclassify 机制 | - |
| 2026-06-21 | 工具 | 放大 Skill 上下文限制：web_search 摘要 120→400字/条数 5→8，browser_read 内容上限 8000→20000字，Agent 循环次数 10→15 | - |
| 2026-06-21 | 前端 | Markdown 渲染升级：引入 remark-gfm，支持 GFM 表格、任务列表、链接等；优化标题/段落/列表/引用块/分割线排版 | - |
| 2026-06-22 | 后端 | Phase 8.5 定时任务系统：scheduled_tasks / task_runs 表迁移（幂等检测），create_scheduled_task / list_scheduled_tasks / cancel_scheduled_task 三个 MCP 工具注册 | - |
| 2026-06-22 | 后端 | Phase 8.5 定时任务系统：schedule REST API（GET /v1/schedule/tasks、GET /v1/schedule/tasks/{id}/runs、PATCH 暂停/恢复、DELETE 取消）+ 内部接口（X-Service-Token 认证） | - |
| 2026-06-22 | 后端 | Phase 8.5 定时任务系统：scheduler-service 独立微服务（APScheduler + 轮询主后端拉取 active 任务，到期执行 remind action，写入 task_runs，WebSocket 推送提醒消息） | - |
| 2026-06-22 | 后端 | Phase 8.5 定时任务系统：docker-compose 新增 cor-scheduler 容器，backend 新增 SCHEDULER_SERVICE_TOKEN / SCHEDULER_SERVICE_URL 环境变量 | - |
| 2026-06-22 | 前端 | Phase 8.5 定时任务系统：lib/api/schedule.ts API 封装 + /workbench/schedule 工作台页面（左侧任务列表 + 右侧详情 + 执行记录） | - |
| 2026-06-22 | 后端 | Phase 8.5 修复：skill_store.py 新增 Scheduler 内置 Skill 卡片（含 tool_names 多工具名字段），skills 表幂等迁移添加 tool_names 列 | - |
| 2026-06-22 | 前端 | Phase 8.5 修复：use-enabled-skill-tools.ts 支持 tool_names 字段（一对多映射），chat/page.tsx 传入 user_id / agent_self_id 供 scheduler 工具注入 | - |
| 2026-06-22 | 前端 | Phase 8.4 可视化渲染：新增 ChartPreview（ECharts）、MermaidPreview、SvgPreview、HtmlPreview 四个渲染组件，CodeBlock 扩展代码/预览 Tab + 流式占位符 + 一键重试 | - |
| 2026-06-22 | 后端 | Phase 8.4 可视化渲染：agent_service 注入 _VISUALIZATION_HINT，引导 Agent 输出 echarts/mermaid/svg/html 代码块格式 | - |

---

## Phase 8.1 — BrowserRead 工具集成

**状态**：已完成
**完成时间**：2026-06-21

### 功能描述

新增 `browser_read` 工具，让 LLM 能用真实浏览器（Playwright + browser-use）读取任意网页的完整内容，作为 `web_search` 的能力补充。

**与 WebSearch 的区别：**

| 工具 | 适用场景 | 返回内容 | 耗时 |
|------|---------|----------|------|
| WebSearch | 关键词搜索，找信息 | 多条摘要（400字/条，最多8条） | ~2s |
| BrowserRead | 读取已知 URL 完整内容 | 完整正文（最多 20000 字） | ~15-30s |

### 技术方案

- **新增服务**：`browser-service/`（独立 Docker 容器，`python:3.12-slim` + Playwright + browser-use）
- **新增工具**：`backend/app/tools/browser_read.py`，注册到 `tool_registry`
- **调用链**：主 LLM → `browser_read` tool → `cor-browser` 容器 → browser-use Agent → Playwright → 页面内容
- **API Key 透传**：browser-use 内部 LLM 使用用户自己的 API Key，不在服务端存储
- **双重降级**：browser-use 失败 → 纯 Playwright 提取；服务未配置 → 友好错误提示
- **防 SSRF**：自动拒绝内网地址（10.x、192.168.x、127.x 等）

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `browser-service/main.py` | 新增 | Browser Service FastAPI 服务主体 |
| `browser-service/requirements.txt` | 新增 | browser-use、playwright、fastapi 依赖 |
| `browser-service/Dockerfile` | 新增 | Debian slim 镜像，安装 Chromium 运行时 |
| `backend/app/tools/browser_read.py` | 新增 | browser_read 工具定义与注册 |
| `backend/app/core/config.py` | 修改 | 新增 `browser_service_url` 配置项 |
| `backend/app/services/agent_service.py` | 修改 | 工具执行时为 browser_read 注入 api_key/model |
| `backend/app/main.py` | 修改 | 导入 browser_read 模块触发工具注册 |
| `backend/app/services/skill_store.py` | 修改 | 新增 BrowserRead 内置 Skill 卡片 |
| `docker-compose.yml` | 修改 | 新增 cor-browser 服务，backend 新增 BROWSER_SERVICE_URL 环境变量 |

### 启动方式

```bash
# 重新构建并启动（首次构建 cor-browser 需要下载 Chromium，约 300MB，耗时较长）
docker compose up -d --build browser-service
docker compose up -d --build backend
```

---

## Phase 8.2 — Agent 流式渲染修复 & Skill 上下文扩容

**状态**：已完成
**完成时间**：2026-06-21

### 流式渲染文字消失 Bug 修复

**问题**：LLM 在思考轮先输出部分文字再调用工具时，前端收到 `reclassify` 信号后把已渲染的文字清空，视觉上像"文字被撤回"。

**根因**：后端采用乐观推送策略，先推 `delta`（假设是最终轮），出现 tool_call 后再推 `reclassify` 让前端撤回。

**修复方案**：改为缓冲策略，彻底消除 `reclassify` 机制：

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| 收到文字 chunk，尚未出现 tool_call | 立即推 `delta` | 缓冲到 `pre_tool_buf`，暂不推送 |
| 第一次出现 tool_call chunk | 推 `reclassify` 信号 | 将 `pre_tool_buf` 作为 `thinking_delta` 一次性推出 |
| 流结束，`finish_reason=stop` | 无需处理 | 将 `pre_tool_buf` 作为 `delta` 推出 |

**变更文件**：`backend/app/services/agent_service.py`、`frontend/app/chat/page.tsx`、`frontend/lib/hooks/use-chat-stream.ts`、`frontend/app/corwork/messages/[peerId]/agent/page.tsx`

### Skill 上下文限制扩容

| 参数 | 旧值 | 新值 |
|------|------|------|
| `web_search` 最大结果条数 | 5 条 | 8 条 |
| `web_search` 每条摘要字数 | 120 字 | 400 字 |
| `browser_read` 页面内容上限 | 8000 字 | 20000 字 |
| Agent 最大循环轮次 | 10 轮 | 15 轮 |

---

## Phase 8.3 — Markdown 渲染升级

**状态**：已完成
**完成时间**：2026-06-21

### 功能描述

升级聊天消息的 Markdown 渲染能力，解决 GFM 表格无法渲染的问题，并全面优化排版细节。

### 核心改动

- **安装 `remark-gfm`**：启用 GitHub Flavored Markdown 支持，表格、任务列表、删除线等语法正常渲染
- **表格渲染**：带 hover 高亮、表头加粗、自动横向滚动（防溢出）
- **标题层级**：`h1` 加底部分割线，`h1/h2/h3/h4` 颜色逐级降低（primary → secondary → muted）
- **引用块**：左侧紫色竖线 + 斜体文字
- **链接**：蓝色下划线，新标签页打开
- **分割线**：细线样式替代默认粗线
- **段落/列表间距**：调整为更舒适的呼吸感

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/components/chat/message-list.tsx` | 修改 | 引入 remark-gfm，新增 table/thead/tbody/tr/th/td/hr/blockquote/a/em/h4 组件渲染 |
| `frontend/package.json` | 修改 | 新增 `remark-gfm@4.0.1` 依赖 |

---

## Phase 8.4 — 聊天框可视化渲染

**状态**：已完成
**完成时间**：2026-06-22

### 功能描述

让 Agent 能够输出 ECharts 数据图表、Mermaid 流程图、SVG 矢量图形、通用 HTML，并在聊天框内实时渲染为可交互的可视化内容，而不是显示为代码块。

**典型场景**：
- Agent 用 web_search / browser_read 采集数据后，直接生成 ECharts 折线图/柱状图/饼图
- Agent 输出系统架构图、流程图（Mermaid）
- Agent 生成 SVG 矢量图形（带缩放控制）
- Agent 输出带样式的 HTML 报告或交互式小工具

### 技术方案

| 语言标识 | 渲染方式 | 库 | 交互 |
|---------|---------|-----|------|
| `echarts` | iframe srcdoc + CDN | ECharts 5（unpkg） | 完整交互（hover、缩放、图例） |
| `mermaid` | iframe srcdoc + CDN | Mermaid 11（unpkg ESM） | 静态渲染 |
| `svg` | 内联 dangerouslySetInnerHTML | 无 | 缩放控制（25%~300%） |
| `html` | iframe srcdoc | 无 | allow-scripts 沙箱 |

**安全策略**：
- iframe 统一使用 `sandbox="allow-scripts"`，不加 `allow-same-origin`（防止访问父页面 Cookie/localStorage）
- SVG 内联前过滤 `<script>` 标签和 `on*` 事件属性
- 图表库通过 unpkg CDN 加载，不走本地服务

**流式体验**：
- 检测到可渲染语言代码块开始（流式输出中）→ 显示"图表生成中..."占位符（带旋转动画）
- 代码块完整输出后 → 立即渲染，无闪烁

**渲染失败处理**：
- 显示错误信息 + "让 AI 修复"按钮
- 点击按钮自动向 Agent 发送修复请求（携带错误信息），Agent 重新生成修正后的代码

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/components/chat/previews/chart-preview.tsx` | 新增 | ECharts 渲染组件，iframe + postMessage 自适应高度，dark 主题 |
| `frontend/components/chat/previews/mermaid-preview.tsx` | 新增 | Mermaid 渲染组件，ESM 模块加载，dark 主题 |
| `frontend/components/chat/previews/svg-preview.tsx` | 新增 | SVG 内联渲染（含 XSS 过滤）+ HtmlPreview 通用 HTML 沙箱 |
| `frontend/components/chat/message-list.tsx` | 修改 | CodeBlock 扩展代码/预览 Tab；MarkdownContent 传入 isStreaming/onRetry；MessageList 新增 onRetry prop |
| `frontend/app/chat/page.tsx` | 修改 | MessageList 传入 onRetry 回调，自动向 Agent 发送修复请求 |
| `backend/app/services/agent_service.py` | 修改 | 新增 _VISUALIZATION_HINT 常量，注入所有 Agent system 消息，引导输出正确代码块格式 |

### 关键设计决策

| 问题 | 决策 | 原因 |
|------|------|------|
| 触发方式 | 代码块语言标识检测 | 无需新增工具，Agent 自然输出即可触发；System Prompt 引导格式 |
| 图表库 | ECharts（数据图表）+ Mermaid（流程图） | LLM 生成 ECharts JSON 配置最稳定；Mermaid 文本描述天然适合 LLM |
| 沙箱策略 | allow-scripts，不加 allow-same-origin | 允许 JS 交互（ECharts 需要），同时防止访问父页面敏感数据 |
| 流式体验 | 代码块结束后渲染，流式中显示占位符 | 避免频繁更新 iframe srcdoc 导致闪烁；与 Phase 8.2 缓冲策略兼容 |
| 渲染失败 | 一键重试（自动发修复请求给 Agent） | 比全自动更可控，避免死循环；用户可选择是否触发 |
| System Prompt | 全局注入 _VISUALIZATION_HINT | 所有 Agent 自动获得可视化能力，无需每个 Agent 单独配置 |

---

## Phase 8.5 — 聊天驱动定时任务系统

**状态**：已完成（MVP 阶段）
**完成时间**：2026-06-22

### 功能描述

用户在聊天中用自然语言描述提醒需求（如"30分钟后提醒我开会"），Agent 自动解析意图并创建定时任务。任务到期后以"Agent 助理"身份主动发消息提醒用户。工作台（`/workbench/schedule`）提供可视化管理界面。

### 实际实现（与原计划的差异）

| 设计项 | 原计划 | 实际实现 | 原因 |
|--------|--------|---------|------|
| 调度引擎位置 | 主后端内置 APScheduler | **独立 scheduler-service 微服务** | 避免 APScheduler 与 FastAPI 异步事件循环冲突 |
| 提醒发送方式 | SSE 推送到聊天 | **写入 corwork.db messages 表 + WebSocket 推送** | 以"Agent 助理"身份发消息，与协作消息系统复用 |
| 工具参数 | trigger_type / cron_expr / action_type 等 | **简化为 title / remind_at / description** | MVP 只做 remind 类型，不调 LLM，无需 API Key |
| user_id 来源 | chat_id 字段 | **由 agent_service 从请求上下文注入** | LLM 不传敏感字段，后端透传 |
| Skill 白名单 | 无 | **新增 tool_names 字段支持一对多映射** | 一个 Skill 卡片对应多个工具名，原有机制不支持 |

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/app/services/corwork_db.py` | 修改 | 新增 `scheduled_tasks` / `task_runs` 表，幂等迁移检测 |
| `backend/app/tools/scheduler.py` | 新增 | `create_scheduled_task`、`list_scheduled_tasks`、`cancel_scheduled_task` 三个 MCP 工具 |
| `backend/app/api/v1/schedule.py` | 新增 | 工作台 REST API + 内部接口（`/v1/schedule/internal/active-tasks`、`/v1/schedule/internal/run-result`） |
| `backend/app/schemas/chat.py` | 修改 | `ChatRequest` 新增 `user_id` / `agent_self_id` 字段 |
| `backend/app/services/agent_service.py` | 修改 | scheduler 工具执行时注入 `user_id` / `target_user_id` |
| `backend/app/services/skill_store.py` | 修改 | 新增 `tool_names` 列（幂等迁移）、`Skill` 类增加 `tool_names` 字段、新增 Scheduler 内置 Skill 卡片 |
| `backend/app/core/config.py` | 修改 | 新增 `scheduler_service_token` / `scheduler_service_url` 配置项 |
| `backend/app/main.py` | 修改 | 导入 `scheduler` 工具模块 + 注册 `schedule_router` |
| `scheduler-service/main.py` | 新增 | APScheduler 调度引擎：轮询主后端拉取 active 任务，到期执行 remind action，写入 task_runs，WebSocket 推送提醒 |
| `scheduler-service/requirements.txt` | 新增 | APScheduler、httpx、fastapi 依赖 |
| `scheduler-service/Dockerfile` | 新增 | python:3.12-slim 镜像 |
| `docker-compose.yml` | 修改 | 新增 `cor-scheduler` 容器，backend 新增 scheduler 相关环境变量 |
| `frontend/lib/api/schedule.ts` | 新增 | `scheduleApi` 封装（任务列表、执行记录、暂停/恢复/取消） |
| `frontend/app/workbench/schedule/page.tsx` | 修改 | 完整工作台页面：左侧任务列表 + 右侧详情 + 执行记录 |
| `frontend/lib/hooks/use-enabled-skill-tools.ts` | 修改 | `resolveToolNames` 支持 `tool_names` 字段（一对多映射，`flatMap` 展开） |
| `frontend/lib/api/client.ts` | 修改 | `Skill` 接口新增 `tool_names?: string[]` 字段 |
| `frontend/lib/hooks/use-chat-stream.ts` | 修改 | `buildRequestBody` / `sendMessage` 新增 `userId` / `agentSelfId` 参数 |
| `frontend/app/chat/page.tsx` | 修改 | 引入 `useAuth`，`sendMessage` 传入 `user_id` / `agent_self_id` |

### 架构说明

```
用户聊天 → Agent 调用 create_scheduled_task
         → 写入 corwork.db scheduled_tasks 表（user_id 由后端注入）
                    ↓
         cor-scheduler 微服务（port 8001）
         每 30 秒轮询 GET /v1/schedule/internal/active-tasks
                    ↓
         到期任务 → 写入 messages 表（msg_type="agent_reminder"）
                 → WebSocket 推送给用户
                 → POST /v1/schedule/internal/run-result 回写执行结果
```

### 关键设计决策

| 问题 | 决策 | 原因 |
|------|------|------|
| 调度引擎位置 | 独立 scheduler-service 微服务 | 避免 APScheduler 与 FastAPI asyncio 事件循环冲突；独立进程更健壮 |
| 服务间认证 | `X-Service-Token` 固定 Token | 内部服务调用，无需 JWT，简单可靠 |
| 提醒发送方式 | 写入 messages 表 + WebSocket 推送 | 复用协作消息系统，提醒消息有历史记录，用户可回溯 |
| MVP 工具简化 | 只做 remind 类型，参数精简 | 不调 LLM 不需要 API Key，降低 MVP 复杂度 |
| Skill 白名单扩展 | skills 表新增 tool_names 列 | 一个 Skill 卡片对应多个工具名，原有单名推断机制不够用 |
| user_id 注入 | agent_service 从请求上下文透传 | LLM 不传敏感字段，前端从 useAuth 获取后随请求传入 |

### 待完成（后续迭代）

- [ ] `agent_run` 类型 action（到期后自动触发 Agent 对话，结果写回聊天）
- [ ] 手动新建任务对话框（工作台内，支持 cron 表达式可视化编辑）
- [ ] 任务到期前推送通知（前端 Toast / 系统通知）
- [ ] 任务暂停 / 恢复操作（API 已实现，前端 UI 待接入）
- [ ] 任务执行失败自动重试（最多 3 次，指数退避）
- [ ] Android 端：定时任务 Tab

---

## Phase 8.6 — 上下文感知与自动管理

**状态**：已完成
**完成时间**：2026-06-23
**背景**：Agent 对话中工具结果（browser_read 单次最多 20000 字）会快速消耗上下文窗口，但用户完全不知道当前占用情况，也无法预判何时会触发 `context_length_exceeded` 错误。本迭代解决"上下文黑盒"问题，并实现智能摘要压缩（超出原计划 P2 目标）。

### 核心问题与解决方案

| 问题 | 现状 | 实际解决方案 |
|------|------|------|
| 上下文占用不可见 | `ctxPercent` 字段永远是 0 | 每条消息显示真实占用百分比 + 对话顶部三色进度条 |
| 超限时直接崩溃 | API 报 `context_length_exceeded` | 两层触发（90% 主动 + 异常被动）+ LLM 智能摘要压缩 |
| 用户无法主动干预 | 无手动压缩入口 | 进度条旁"剪刀"按钮，一键手动压缩 |

### 实际实现（超出原计划）

原计划 P2（智能摘要压缩）留到 Phase 8.7，实际在本迭代一并完成：

| 设计项 | 原计划 | 实际实现 |
|--------|--------|---------|
| 压缩技术 | 截断工具结果（保留前 300 字） | **LLM 智能摘要**（用当前模型单开调用，max_tokens=1000，失败降级截断） |
| 触发机制 | 单层（85% 估算截断） | **两层**：90% 主动触发 + `context_length_exceeded` 异常被动降级 |
| token 计算 | 字符数 / 3 粗估 | **API 返回的 `usage.prompt_tokens` 累计**（最准确） |
| 用户感知 | 无（静默压缩） | **聊天流中插入压缩节点**（可展开查看摘要内容）+ 进度条 |
| 手动压缩 | 无 | **进度条旁剪刀按钮**，`compress_only=true` 模式，与自动压缩同路径 |

### 技术架构

```
前端 totalInputTokens 累计（每轮 usage.prompt_tokens 累加）
         ↓
ctxUsagePercent = totalInputTokens / contextLimit × 100
         ↓
  ┌──────┴──────────────────────────────────┐
  │ 0~70%: 绿色进度条，无预警               │
  │ 70~90%: 黄色进度条，输入框黄色横幅      │
  │ 90~95%: 红色进度条，后端主动触发压缩    │
  │ 95%+: 红色横幅 + 开启新对话按钮         │
  └─────────────────────────────────────────┘

后端两层压缩触发：
  第一层：每轮发送前检测 total_input_tokens / context_limit > 0.90
          → 调用 _compress_messages()（LLM 摘要）
          → 推送 compressing / compress_done SSE 事件
  第二层：捕获 openai.BadRequestError（context_length_exceeded）
          → 再次调用 _compress_messages() 后重试

_compress_messages() 压缩优先级：
  永远保留：system / user / 最近 3 轮 assistant+tool
  优先压缩：早期 tool 消息（>500字）
  次之压缩：早期 assistant 思考轮（>300字）
  摘要上限：1000 tokens（约 700-800 中文字）
```

### 变更文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/app/services/agent_service.py` | 修改 | 新增 MODEL_CONTEXT_LIMITS（30+ 模型）、_get_context_limit()、_compress_messages()、_serialize_messages_for_frontend()、_compress_only_mode()；_agent_loop_openai() 两层压缩触发；done 事件新增 context_limit |
| `backend/app/schemas/chat.py` | 修改 | ChatRequest 新增 `compress_only: bool = False` |
| `frontend/lib/hooks/use-chat-stream.ts` | 修改 | 新增 CompressingEvent / CompressDoneEvent 接口；onDone 新增 contextLimit 参数；SSE 路由处理 compressing / compress_done 事件 |
| `frontend/app/chat/page.tsx` | 修改 | 新增 totalInputTokens / contextLimit / isCompressing state；handleManualCompress 手动压缩回调；onDone 累计 token；onAgentEvent 处理压缩节点；ChatToolbar / ChatInput 传入上下文 props |
| `frontend/components/chat/chat-toolbar.tsx` | 修改 | 新增 ContextBar 组件（三色进度条 + 百分比 + token 数 + 手动压缩按钮） |
| `frontend/components/chat/agent-flow-chart.tsx` | 修改 | 新增 CompressingNode（紫色主题，可展开查看压缩消息摘要列表） |
| `frontend/components/chat/message-list.tsx` | 修改 | MessageMeta ctxPercent 颜色随占用变化（70%+ 黄色，90%+ 红色，加粗） |
| `frontend/components/chat/chat-input.tsx` | 修改 | 新增 ctxUsagePercent / onNewConversation props；80%/95% 预警横幅 |

### 关键设计决策

| 问题 | 决策 | 原因 |
|------|------|------|
| 压缩技术 | LLM 智能摘要（非截断） | 截断丢失语义；LLM 摘要保留关键信息，对话连贯性更好 |
| 压缩 LLM | 单开当前模型，用完即弃 | 不引入新模型依赖；用户已配置的模型直接复用 |
| token 计算 | API 返回的 usage.prompt_tokens | 比字符数估算准确 10 倍；无需本地 tokenizer |
| 触发阈值 | 90%（非 85%） | 给压缩本身留出 token 空间（摘要最多 1000 tokens） |
| 用户感知 | 聊天流插入压缩节点（可展开） | 透明化压缩过程；用户可查看哪些内容被压缩 |
| 手动压缩 | compress_only 模式复用同一路径 | 代码复用；手动/自动行为完全一致 |
| 消息保留策略 | 永远保留最近 3 轮 + system/user | 保证对话连贯性；工具结果是最大的 token 消耗来源 |
