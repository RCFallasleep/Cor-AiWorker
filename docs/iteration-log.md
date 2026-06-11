# Cor-AiWorker 迭代进度日志

> 项目名称：Cor-AiWorker  
> 项目定位：基于多 Agent 协作的团队开发对齐系统  
> 技术选型：Web 前端 Next.js 14 + React + TypeScript + Tailwind CSS + shadcn/ui / 后端 Python + FastAPI + LangChain / 客户端 Android（Compose，按需）

---

## 当前阶段：Phase 3 — CorWork 需求对齐 & WorkBench 工作台

**状态**：待启动
**开始时间**：-
**完成时间**：-

### 本阶段目标

#### CorWork 协作空间
- [ ] 多人 + 多 Agent 群聊协作空间 UI
- [ ] 需求拆解与任务分配流程
- [ ] 实时通信（WebSocket）

#### WorkBench 工作台
- [ ] 协作进度看板
- [ ] API 用量监控
- [ ] 定时任务配置与管理
- [ ] Skill / MCP 上传与管理

---

## 已完成阶段

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

#### 设置内容
- [ ] 思考模式（Thinking Mode）开关
- [ ] 当前 Token 用量显示 + 上下文长度显示

#### 特殊功能
- [ ] 聊天队列（支持插入聊天 / 中断重排）
- [x] 为 MCP / Skill 预留接口与 UI 插槽（`+` 按钮占位）

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

#### API Key 接入体验优化
- [x] 统一接入方式：只需填模型名 + API Key + Base URL（可选），协议自动识别（sk-ant-* → Anthropic，其他 → OpenAI 兼容）
- [x] 去掉 Provider 下拉选择，表单从 5 个字段简化为 3 个字段
- [x] 填写时实时显示协议识别结果（Anthropic / OpenAI 兼容）
- [x] 列表行显示协议徽章（自动识别）+ 模型名 + Base URL

#### Chat UI 细节优化
- [x] 输入框高度随内容动态增长（最多 6 行，超出显示滚动条），发送后平滑回缩
- [x] AI 等待响应时显示跳动三点胶囊动画（dotBounce，三点依次弹跳）
- [x] AI 消息气泡宽度由内容决定（fit-content，最宽 80%），短回复不撑满，长回复自然换行

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

### Phase 3 — CorWork 需求对齐
- 多人 + 多 Agent 群聊协作空间
- 需求拆解与任务分配流程
- 实时通信（WebSocket）

### Phase 4 — WorkBench 工作台
- 协作进度看板
- API 用量监控
- 定时任务配置与管理
- Skill / MCP 上传与管理

### Phase 5 — 开发者功能 & 实验功能
- 日志查看（Agent 执行链路）
- 工作流可视化（MCP 积木搭建）
- 养成龙虾（等级 / 梦境系统）

### Phase 6 — 后端 & 部署
- FastAPI + LangChain 后端搭建
- 多模型接入（OpenAI / Claude / 本地模型）
- Docker 部署方案
- Android 客户端（按需）

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
| 2026-06-11 | Phase 1-2 | Phase 1-2 全部完成，进入 Phase 3（CorWork + WorkBench）规划 | - |
