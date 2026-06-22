# Cor-AiWorker 迭代进度日志

> 项目名称：Cor-AiWorker
> 项目定位：基于多 Agent 协作的团队开发对齐系统
> 技术选型：Web 前端 Next.js 15 + React + TypeScript / 后端 Python + FastAPI（编排自实现）/ 客户端 Android（Jetpack Compose）

---

## 当前阶段：Phase 7 — 本地代码编辑 + Agent 文件操作 + 断点调试闭环

**状态**：已完成（Phase A/B/C 全部完成 + 后续体验优化）
**开始时间**：2026-06-17
**最后更新**：2026-06-17

### 阶段说明

本阶段目标是让 Web 端 Agent 突破浏览器沙箱限制，具备对本地文件系统的无痛读写能力，并与 Android Studio 的调试过程形成完整闭环。

核心思路：后端作为本地文件系统的代理层，Agent 通过 MCP 工具调用后端接口完成文件操作；Android Studio 侧通过已有的 debuggerPlugin 采集断点快照并推送给后端，Agent 可读取快照、设置断点、等待调试结果，形成「编辑 → 运行 → 断点分析 → 修复」的自动化循环。

### 架构决策

| 决策项 | 结论 |
|--------|------|
| 文件访问方式 | 后端本地文件服务（B方案），Agent 主动读写，无需用户每次手动授权 |
| 安全边界 | workspace_root 机制：用户打开文件夹后，所有文件操作限制在该目录内 |
| IDE 推送方式 | 直接写磁盘（VSCode/AS 文件监听自动刷新）+ debuggerPlugin /recommend 接口（AS 断点推荐） |
| 断点触发方式 | Agent 调用 set_breakpoint 工具推送断点位置，用户负责在 AS 运行，Agent 通过 wait_for_breakpoint 等待结果 |
| 页面布局 | /workbench/editor 三栏布局：文件树（左）+ Monaco 编辑器（中）+ Agent 对话区（右），类 Cursor 风格 |
| 对话与 Chat 分离 | 代码编辑页面独立 Agent 对话区，与 /chat 页面完全分开 |

---

### Phase A：后端文件系统 MCP 工具（进行中）

#### 后端
- [x] `open_workspace` 接口：`POST /v1/workspace/open`，接收本地路径，验证存在后设为 workspace_root，内存存储
- [x] `list_dir` MCP 工具：列出目录文件树（递归，限制在 workspace_root 内），注册到 tool_registry
- [x] `read_file` MCP 工具：读取文件内容（路径校验，支持 start_line/end_line 分段读取），注册到 tool_registry
- [x] `write_file` MCP 工具：写入/覆盖文件（路径校验，自动创建父目录），注册到 tool_registry
- [x] `GET /v1/workspace/file` 接口：前端直接读取文件内容（供编辑器加载用）
- [x] `PUT /v1/workspace/file` 接口：前端直接写入文件（供编辑器手动保存用）
- [x] `GET /v1/workspace/tree` 接口：前端拉取文件树（供文件树组件渲染用）
- [x] `workspace_service.py`：workspace_root 安全边界（resolve_path 路径前缀校验），忽略 node_modules/.git 等目录

---

### Phase B：前端代码编辑页面重构（待开始）

#### 前端 — 三栏布局
- [x] `/workbench/editor` 页面重构为三栏布局（文件树 + Monaco 编辑器 + Agent 对话区）
- [x] 文件树组件：调用 `GET /v1/workspace/tree`，渲染目录树，点击文件加载到编辑器，目录可折叠
- [x] 「打开文件夹」入口：用户输入本地路径，POST 到后端设置 workspace_root，成功后渲染文件树
- [x] Monaco 编辑器：加载选中文件内容，手动保存（Cmd+S）调用 `PUT /v1/workspace/file`，Tab 栏未保存 ● 标记
- [x] Agent 对话区：复用 `use-chat-stream`，模型选择器，工具调用卡片（图标+文件名+状态+可展开结果）
- [x] write_file 后编辑器自动刷新：Agent 调用 write_file 工具后，前端自动重新加载对应文件内容
- [x] 快捷提示按钮：根据当前打开文件动态生成（分析/优化/列出文件）
- [x] tool_names 白名单：只给文件工具 + 调试工具，不暴露协作工具

---

### Phase C：断点调试闭环（已完成）

#### 后端
- [x] `debug_bridge` 接口：`POST /v1/debug/snapshot`，接收 debuggerPlugin 推送的断点快照，内存缓存最近 20 条（`deque(maxlen=20)`）
- [x] `GET /v1/debug/snapshot/latest`：返回最新断点快照（供 Agent 工具轮询）
- [x] `GET /v1/debug/snapshot/list`：返回最近 N 条快照列表
- [x] `POST /v1/debug/recommend`：向 AS 插件（18766端口）转发断点推荐
- [x] `get_debug_snapshot` MCP 工具：格式化输出最新断点快照（兼容单断点/多断点 diff 两种格式），支持 index 参数
- [x] `set_breakpoint` MCP 工具：直接 POST 到 `localhost:18766/recommend`，推送断点推荐给 AS 插件
- [x] `wait_for_breakpoint` MCP 工具：轮询等待新快照（每 2 秒检查，最多 180 秒），超时返回提示
- [x] `get_snapshots_deque()` / `get_snapshot_event()`：供 MCP 工具直接访问快照缓存（避免 HTTP 内部调用）

#### 前端
- [x] `DebugPanel` 组件：右侧 Agent 对话区底部专用断点面板，可折叠
  - 标题栏：Bug 图标 + 「等待命中」动画徽章 / 「已命中」红色徽章 + 刷新按钮
  - 等待状态：脉冲圆环动画 + 「等待断点命中...」提示
  - 快照展示：位置信息（文件:行号 + 类名.方法名）+ 时间戳（X秒前）
  - 变量 Tab：变量名/类型/值三列，支持子变量缩进展示（最多 5 层）
  - 调用栈 Tab：帧序号 + 类名.方法名 + 行号，当前帧红色高亮
  - 多断点 diff 格式：断点 ID + 位置 + keyVars 标签 + 变化量（黄色 △ 标记）
- [x] 断点状态轮询：启动时拉取一次，之后每 5 秒轮询 `GET /v1/debug/snapshot/latest`
- [x] `wait_for_breakpoint` 工具调用联动：Agent 调用时激活等待状态，完成后关闭并刷新快照
- [x] 底部状态栏断点指示：等待中显示「等待断点...」黄色动画，已命中显示「断点已命中」红色圆点
- [x] 输入框解除工作区限制：即使未打开工作区也可与 Agent 对话（调试场景不需要文件树）

---

## Phase 6（进行中）— 消息对话与 Agent 转发，Agent 记忆后端化

**状态**：进行中（6-1a/6-1b/6-1c 核心功能已完成，「公共记忆」管理入口延后）
**开始时间**：2026-06-17
**最后更新**：2026-06-17

### 阶段说明

本阶段在 Phase 5 协作基础上，完成消息协作的核心体验升级：

1. **联系人交互完善**：头像点击弹出小卡片，卡片内有「和 TA 的 Agent 对话」入口
2. **Agent 代理对话**：新开一个 Chat LLM 样式的对话，Model 本地选，Prompt = MCP 预置模版 + 对方 ComMemory（从后端拉取），目的是高效了解对方动向
3. **Agent 转发 MCP**：在 Agent 对话里让 Agent 调用 `forward_message` 工具，以「自己的 Agent」身份向对方发消息，对方看到「[发送者] 的 Agent，转发自 [我]」
4. **Agent 记忆后端化**：三层记忆（Soul/Memory/User/ComMemory）统一上后端，用户手动指定内容写入，可编辑，ComMemory 跨 Agent 共享

### 架构决策

| 决策项 | 结论 |
|--------|------|
| Agent 对话的 Model | 本地提供（用户自选，走本地 API Key） |
| Agent 对话的 Prompt | MCP 预置模版（「你是 XX 的代理人...」）+ 对方 ComMemory（后端拉取） |
| 转发消息的发送者 | 显示为「[我] 的 Agent，转发自 [我]」，对方看到特殊样式 |
| 记忆写入时机 | 用户手动指定内容保存（MCP 工具触发写入，或后端管理页编辑） |
| ComMemory 存储 | 后端 `agent_memories` 表，type=common，跨 Agent 可读 |

---

### Phase 6-1a：联系人头像卡片 + Agent 对话入口 ✅

#### 后端
- [x] `agent_memories` 表：`id / user_id / agent_id / type（soul/memory/user/common）/ title / content / updated_at`
- [x] `GET /v1/memories/peer/{user_id}/common`：获取指定用户的 ComMemory（供 Agent 对话注入 Prompt）
- [x] `GET /v1/memories/me`：获取我的所有记忆（按 type 分组）
- [x] `POST /v1/memories`：新建记忆条目
- [x] `PUT /v1/memories/{id}`：编辑记忆内容
- [x] `DELETE /v1/memories/{id}`：删除记忆

#### 前端 — 联系人卡片
- [x] 会话列表头像点击 → 弹出联系人小卡片（用户名 / Agent 名 / 两个按钮：「发消息」「让 Agent 帮我起草」）
- [x] 跳转到 `/corwork/messages/${peerId}/agent`（消息模块内嵌 Agent 起草页）

#### 前端 — Agent 对话页（重构为「我的 Agent 起草」思路）
- [x] 进入对话时，从后端拉取对方 ComMemory（`GET /v1/memories/peer/{userId}/common`）
- [x] 构建 System Prompt：「你是 {myName} 的助手，帮我给 {peerName} 起草消息」+ 对方 ComMemory 注入
- [x] 使用 `useAvailableModels` hook 读取真实 API Key（修复 401 bug）
- [x] 顶部标识：「我的 Agent → {peerName}」+ 模型选择器
- [x] 快捷提示按钮：「帮我起草一条消息」「我想约他/她开会」「帮我问一下进度」
- [x] 工具调用卡片：`forward_message` 显示「📨 发送给 {peerName}」+ 消息内容预览

---

### Phase 6-1b：Agent 转发 MCP 工具 ✅

#### 后端
- [x] 新增 `forward_message` MCP 工具（`app/tools/forward_message.py`）
  - 参数：`receiver_id: str`，`content: str`（Agent 总结后的转发内容）
  - 写入 `msg_type = "agent_forward"` 消息到 DB + WebSocket 推送给接收方
  - 自动注册到全局 `tool_registry`
- [x] `messages` 表新增 `forward_from` 字段（原始发送者 user_id）
- [x] `GET /v1/collab/messages/{peerId}` 返回 `forward_from` 字段

#### 前端
- [x] 转发消息特殊气泡样式：紫色渐变气泡 + Sparkles 头像 + 「TA 的 Agent 转发」/ 「我的 Agent 转发」标签
- [x] 接收方聊天页：识别 `msg_type=agent_forward`，渲染特殊样式

---

### Phase 6-1c：Agent 记忆管理（进行中）

#### 后端（已在 6-1a 建表，接口已完成）
- [x] `GET /v1/memories/me`：返回我的所有记忆（soul/memory/user/common 分组）
- [x] 记忆写入 MCP 工具（`save_memory.py`）：Agent 对话中用户说「记住这个」→ Agent 调用工具写入后端

#### 前端 — 记忆管理抽屉
- [x] 消息对话页顶部栏新增「记忆」按钮（绿色，Brain 图标）
- [x] 点击弹出右侧抽屉（`MemoryDrawer` 组件，`components/corwork/memory-drawer.tsx`）
- [x] 按 type 分组展示（公共记忆 / 灵魂设定 / 工作记忆 / 用户记忆），各组可折叠
- [x] 每组显示条目数量角标 + 「+」新建按钮
- [x] 条目 hover 显示编辑/删除按钮，删除需二次确认
- [x] 内联编辑表单（标题可选 + 内容必填），保存后实时更新列表
- [ ] 「公共记忆」管理入口（ComMemory，在消息页或设置页，可新建/编辑/删除）

---

## Phase 5（已完成）— Cor-AiWorker 协作建设（前端 + 后端 + 客户端）

**状态**：完成
**开始时间**：2026-06-16
**完成时间**：2026-06-17

### 阶段说明

本阶段解决的核心痛点是**人与人之间协作的需求对齐问题**：

- 找某个人聊天时不知道切入口，和人直接交流有心理负担
- 解法：让 Agent 作为代理人，用户先和对方的 Agent 对话 → 确认表达 → Agent 转发给真人
- 人与人直接合作项目时，需要代理 Agent 对接一层需求，再和别人的 Agent 对接二层需求

**本阶段先在 Web 端完成 UI，Android 端同步跟进核心功能。**

### Phase 5A 任务清单（后端基础建设）

#### 后端 — 平台数据库与用户系统
- [x] `core/config.py`：新增 `corwork_db_path`（`/data/corwork.db`）、JWT 配置（secret/algorithm/expire）、Android 模拟器 CORS 白名单
- [x] `services/corwork_db.py`：平台核心数据库，WAL 模式，5 张表（users / agent_profiles / contacts / messages / projects / project_members），幂等初始化
- [x] `services/user_service.py`：bcrypt 密码哈希、JWT 签发/验证、用户 CRUD（create/authenticate/get_by_id/get_by_username/list）
- [x] `core/auth.py`：FastAPI 依赖注入（`get_current_user` / `get_current_user_optional`），Bearer Token 解析
- [x] `api/v1/auth.py`：`POST /v1/auth/register`、`POST /v1/auth/login`、`GET /v1/auth/me`
- [x] `requirements.txt` 新增 `passlib[bcrypt]==1.7.4`、`python-jose[cryptography]==3.3.0`

#### 后端 — 协作消息系统
- [x] `api/v1/collab.py`：完整协作 API 路由
  - Agent 名片：`GET/PUT /v1/collab/agent-profile`、`GET /v1/collab/agent-profile/{user_id}`
  - 联系人：`GET/POST /v1/collab/contacts`、`DELETE /v1/collab/contacts/{id}`
  - 消息：`GET /v1/collab/messages/{peer_id}`（分页+自动标记已读）、`POST /v1/collab/messages`
  - 会话列表：`GET /v1/collab/conversations`（含最新消息+未读数）
  - 用户搜索：`GET /v1/collab/users/search?q=`
  - WebSocket：`WS /v1/collab/ws?token=<jwt>`（实时消息推送）
- [x] `_WSManager`：按 user_id 管理 WebSocket 连接池，支持多设备同时在线
- [x] `_agent_auto_reply()`：Agent 模拟回复（local 模式），预留 `platform` 模式接口（`endpoint_url`）
- [x] `_make_conversation_id()`：双向唯一会话 ID（两个 user_id 排序拼接）

#### 后端 — 管理界面升级
- [x] `api/v1/admin.py`：`GET /v1/admin/stats`（系统统计 JSON）+ `GET /v1/admin/`（HTML 管理面板）
- [x] 管理面板功能：概览（运行时长/用户数/消息数/数据库大小）+ 用户列表 + Agent 日志流 + 快捷链接
- [x] `main.py` 根路径 `/` 重定向到 `/v1/admin/`，打开 localhost:8000 直接进管理面板

#### 前端 — 认证系统
- [x] `lib/api/client.ts`：统一 API 客户端（Token 管理、请求头注入、401 自动跳转登录、authApi/collabApi/createCollabWS）
- [x] `contexts/auth-context.tsx`：AuthProvider + useAuth Hook（user/loading/login/register/logout）
- [x] `app/login/page.tsx`：登录/注册页（Tab 切换、表单验证、错误提示）
- [x] `components/layout/app-shell.tsx`：AppShell 组件，`/login` 路径跳过侧边栏，其他路径正常渲染
- [x] `app/layout.tsx`：引入 AuthProvider + AppShell，替换原有硬编码布局

#### 前端 — 消息协作页面
- [x] `app/corwork/messages/page.tsx`：会话列表页（ConversationItem 组件、未读角标、添加联系人弹窗、用户搜索）
- [x] `app/corwork/messages/[peerId]/page.tsx`：对话页（MessageBubble 气泡、乐观更新、WebSocket 实时接收、Enter 发送、Agent 回复紫色标识）

### Phase 5 后续任务清单

#### Web 端 — 已完成
- [x] 消息页重构：左右分栏布局（企业微信风格），`messages/layout.tsx` + `ConversationList` 组件
- [x] 好友申请系统：`friend_requests` 表 + 6 个接口（发申请/查收到/查发出/同意拒绝/撤回/删除好友）
- [x] WebSocket 实时推送好友申请通知（`friend_request` / `friend_request_result` 事件）
- [x] 前端好友申请：`FriendRequestInbox` 组件 + Bell 角标 + 添加好友改为发申请流程
- [x] 侧边栏用户头像：移到顶部，点击弹出用户卡片（含退出登录）
- [x] Bug 修复：`friend_requests` 表 404（`sqlite_master` 迁移检测）
- [x] Bug 修复：多 Tab 登录态互相覆盖（`localStorage` → `sessionStorage` tab 级别隔离）
- [x] Bug 修复：CORS + credentials 冲突（`allow_origin_regex=".*"` + `allow_credentials=False`）

#### Web 端 — 待完成
- [ ] 项目 Tab：新建项目 + 项目看板
- [ ] 协作看板 Tab：占位
- [ ] Agent 名片编辑页（`/corwork/messages` 内嵌入口）
- [ ] 消息页：加载更多历史消息（上拉分页）

#### Android 端 — 已完成
- [x] 数据层：`ApiService.kt`（Retrofit 接口）/ `ApiClient.kt`（动态 baseUrl，`buildService(url)`）/ `AuthDataStore.kt`（DataStore 存 token/userId/username/serverUrl）/ `AuthModels.kt` / `CollabModels.kt`
- [x] UI 主题：`Theme.kt`（深色，primary `#6366F1`）/ `Type.kt`
- [x] 登录页：`LoginViewModel.kt`（登录/注册 + 错误处理）/ `LoginScreen.kt`（支持切换，含可折叠服务器地址输入框）
- [x] 主框架：`MainScreen.kt`（BottomNav：消息/项目/协作看板）
- [x] 消息列表：`MessagesScreen.kt`（会话列表 + WebSocket 实时刷新）
- [x] 聊天页：`ChatScreen.kt`（乐观更新 + WebSocket 实时接收）
- [x] 占位页：`ProjectsScreen.kt` / `BoardScreen.kt`
- [x] 入口路由：`MainActivity.kt`（检测 token → 路由到登录页或主页，`onLogout` 清除 DataStore）
- [x] WebSocket 长连接：`CollabWebSocket.kt`（OkHttp WS + `SharedFlow<WsEvent>`，`pingInterval=20s` 保活，`DisposableEffect` 自动管理生命周期）
- [x] 服务器地址动态配置：登录页可折叠输入框，地址保存到 DataStore，重启 App 自动回填，无需重新打包

#### Android 端 — 待完成
- [ ] 项目 Tab：接入后端项目接口
- [ ] 协作看板 Tab：接入后端看板接口
- [ ] 好友申请：Android 端接收 `friend_request` WebSocket 事件并展示通知

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

### Phase 4 — MCP/Skill 建设 & 多模态 Chat ✅（已完成）
- [x] Skills 看板：后端 CRUD + SQLite 持久化 + 前端仓库风格预览弹窗
- [x] 多模态 Chat：图片上传 + 粘贴截图 + 三协议格式转换
- [x] 文档上传解析：`POST /v1/documents/upload` 接口 + `document_store.py` 内存分块存储 + `read_document` 内置工具
- [x] `_read_tool_source()` 联动：内置 Skill 展示代码从真实 `.py` 文件动态读取，消除双份维护
- [ ] Skills 看板编辑功能（当前只有新建和删除，缺少编辑已有 Skill 文件的入口）
- [ ] 存档系统：支持从历史存档恢复研讨会模式（当前恢复时 mode 固定为 "graph"）
- [ ] Think Tank 导出报告功能（当前按钮 disabled 占位）

### Phase 5（当前）— Cor-AiWorker 协作建设（前端 + 后端 + 客户端）
- Web 端协作区竖边栏：消息 Tab（联系人 + Agent 代理对话）+ 项目 Tab（看板 + 审查）+ 协作看板占位
- 后端：联系人/消息/项目数据模型 + WebSocket 实时通信 + Agent 代理转发接口
- Android 端（Jetpack Compose）：消息列表 + Agent 对话 + 项目看板 + WebSocket 实时消息

### Phase 6 — WorkBench 工作台进阶
- 协作进度看板（Phase 5 协作看板 Tab 的完整实现）
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
| 2026-06-15 | 文档解析方案 | 内存分块存储（DocumentStore），每块 1500 字，Agent 按需调用 read_document 工具读取 | 避免一次性注入 system prompt 导致 token 超限；TTL 2h 自动清理，无磁盘 IO |
| 2026-06-15 | 内置 Skill 代码展示 | _read_tool_source() 运行时读取真实 .py 文件，替代硬编码字符串 | 单一来源，改工具代码后展示自动跟随，无需手动同步两份副本 |
| 2026-06-16 | Android 客户端 | Jetpack Compose，由用户自行搭建项目骨架，后续接入后端 WebSocket + Agent 接口 | Phase 5 协作功能需要移动端支持，Web 端先行，Android 同步跟进 |
| 2026-06-16 | 协作核心设计 | Agent 作为代理人：用户先和对方 Agent 对话确认表达，Agent 再转发给真人 | 解决人与人直接沟通的心理负担和切入口问题 |
| 2026-06-16 | 数据库架构 | 保持 SQLite，新增 corwork.db（WAL 模式）作为平台数据库，与 agent_logs.db/skills.db 并列 | 本机部署，并发量小，SQLite WAL 够用；单文件备份方便；Android 通过 REST API 接入，不直接碰 DB |
| 2026-06-16 | 数据归属策略 | 协作数据（用户/消息/项目）→ 后端；个人数据（聊天记录/API Key/文档）→ 本地 | 不做全面迁移，新功能从一开始走后端，老功能保持现状 |
| 2026-06-16 | Agent 回复模式 | local 模式：本机 LLM 模拟对方 Agent 回复；platform 模式：预留 endpoint_url 接口 | 现阶段无平台级 LLM 管理，local 模式先跑通产品逻辑，platform 接口留好入口 |
| 2026-06-16 | 登录方案 | 自建用户系统（bcrypt + JWT），不做 OAuth | 本机部署，自控，半天实现；30 天 Token 有效期，移动端友好 |
| 2026-06-16 | 前端布局 | AppShell 组件判断路径，/login 全屏无侧边栏，其他路径正常渲染 | 避免 Next.js Server Component 不能用 usePathname 的问题 |
| 2026-06-16 | 好友申请状态机 | `UNIQUE(from_id, to_id)`，被拒/取消后可重新申请，同意后双向写 contacts | 防止重复申请，同时保留重试能力 |
| 2026-06-16 | 多 Tab 登录隔离 | `localStorage` → `sessionStorage`（tab 级别隔离） | 同域 localStorage 共享导致多账号登录互相覆盖 |
| 2026-06-16 | Android 服务器地址 | 登录页可折叠输入框 + DataStore 持久化，无需重新打包 | 局域网 IP 随网络环境变化，写死不可行；扫码/mDNS 方案复杂度高，输入框最实用 |
| 2026-06-16 | Android WebSocket | OkHttp 原生 WebSocket API，无额外依赖，`pingInterval=20s` 保活 | OkHttp 已是 Retrofit 依赖，零增量；`DisposableEffect` 管理生命周期，页面销毁自动断开 |
| 2026-06-16 | Android 消息实时性 | ChatScreen 收到 WS `new_message` 直接追加（去重），MessagesScreen 收到后重新拉取会话列表 | ChatScreen 追加避免重复请求；MessagesScreen 重拉保证未读数/时间准确 |
| 2026-06-16 | Android 乐观更新 | 发送时先本地追加临时消息（`opt-` 前缀 id），服务端返回后替换；失败则移除 | 消除网络延迟感，失败回滚保证一致性 |

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
| 2026-06-15 | Phase 4 | 文档上传解析：document_store.py（内存分块，TTL 2h，支持 PDF/DOCX/TXT/MD）+ POST /v1/documents/upload 接口 + read_document 内置工具（分块读取，返回 total_chunks）+ 前端附件卡片（解析中→N块·XKB）+ system prompt 注入文件信息 | - |
| 2026-06-15 | Phase 4 | 内置 Skill 代码联动：_read_tool_source() 从真实 .py 文件动态读取源码，_BUILTIN_SKILLS 展示代码不再硬编码，改一处自动同步，消除双份维护负债 | - |
| 2026-06-15 | Phase 4 | ReadDocument 加入 Skills 看板：_BUILTIN_SKILLS 新增 ReadDocument 种子数据（README.md + document_store.py + read_document.py），seed_builtin_skills() 启动时自动同步 | - |
| 2026-06-16 | Phase 5A | 架构决策：保持 SQLite，新增 corwork.db（WAL 模式）；数据归属策略（协作→后端，个人→本地）；Agent 回复 local/platform 双模式 | - |
| 2026-06-16 | Phase 5A | 后端用户系统：corwork_db.py（5 张表）+ user_service.py（bcrypt+JWT）+ core/auth.py（依赖注入）+ api/v1/auth.py（注册/登录/me） | - |
| 2026-06-16 | Phase 5A | 后端协作 API：api/v1/collab.py（Agent 名片/联系人/消息/会话列表/用户搜索/WebSocket）+ _WSManager 连接池 + _agent_auto_reply 模拟回复 | - |
| 2026-06-16 | Phase 5A | 后端管理面板：api/v1/admin.py（系统统计 JSON + HTML 管理界面），根路径重定向到管理面板 | - |
| 2026-06-16 | Phase 5A | 前端认证：lib/api/client.ts（统一 API 客户端）+ contexts/auth-context.tsx（AuthProvider）+ app/login/page.tsx（登录/注册页）+ components/layout/app-shell.tsx（路径判断跳过侧边栏） | - |
| 2026-06-16 | Phase 5A | 前端消息页：app/corwork/messages/page.tsx（会话列表+添加联系人弹窗）+ app/corwork/messages/[peerId]/page.tsx（对话页+乐观更新+WebSocket+Agent 紫色标识） | - |
| 2026-06-16 | Phase 5A | 竖边栏重构：CorworkSidebar 移到全局 layout，usePathname 判断路径，收起时拉手贴主侧边栏右边缘；nav-config 协作分组改为「交流协作」单入口；nav-group 激活判断改为前缀匹配+最长优先 | - |
| 2026-06-16 | Phase 5B | 消息页重构：左右分栏布局，messages/layout.tsx 容器 + ConversationList 组件，聊天页去掉返回按钮 | - |
| 2026-06-16 | Phase 5B | 好友申请后端：friend_requests 表（pending/accepted/rejected/cancelled）+ 6 个接口 + WebSocket 推送 friend_request/friend_request_result 事件 | - |
| 2026-06-16 | Phase 5B | 好友申请前端：FriendRequestInbox 组件 + Bell 角标 + 添加好友改为发申请流程 + WS 监听实时更新角标 | - |
| 2026-06-16 | Phase 5B | 侧边栏用户头像：移到顶部，点击弹出用户卡片（含退出登录），去掉独立退出按钮 | - |
| 2026-06-16 | Phase 5B | Bug 修复：旧 corwork.db 无 friend_requests 表导致 404，init_db() 加 sqlite_master 迁移检测自动补建 | - |
| 2026-06-16 | Phase 5B | Bug 修复：多 Tab 登录态覆盖，localStorage 改 sessionStorage，tab 级别隔离 | - |
| 2026-06-16 | Phase 5B | Bug 修复：CORS allow_origins=["*"] 与 allow_credentials=True 冲突，改 allow_origin_regex=".*" + allow_credentials=False | - |
| 2026-06-16 | Phase 5C | Android 数据层：ApiService.kt（Retrofit 接口）/ ApiClient.kt（buildService 动态 baseUrl）/ AuthDataStore.kt（DataStore，新增 serverUrl 字段）/ AuthModels.kt / CollabModels.kt | - |
| 2026-06-16 | Phase 5C | Android UI 主题：Theme.kt（深色，primary #6366F1）/ Type.kt | - |
| 2026-06-16 | Phase 5C | Android 登录页：LoginViewModel.kt（登录/注册 + 错误分类）/ LoginScreen.kt（登录/注册切换 + 可折叠服务器地址输入框，启动回填上次地址） | - |
| 2026-06-16 | Phase 5C | Android 主框架：MainScreen.kt（BottomNav 消息/项目/协作看板）/ ProjectsScreen.kt / BoardScreen.kt 占位 | - |
| 2026-06-16 | Phase 5C | Android 消息列表：MessagesScreen.kt（会话列表 + 未读角标 + WebSocket 收到新消息自动刷新） | - |
| 2026-06-16 | Phase 5C | Android 聊天页：ChatScreen.kt（历史消息加载 + 乐观更新发送 + WebSocket 实时接收对方消息） | - |
| 2026-06-16 | Phase 5C | Android 入口路由：MainActivity.kt（AppRoot 监听 DataStore tokenFlow/userIdFlow/serverUrlFlow，自动路由登录页或主页，onLogout 清除 DataStore） | - |
| 2026-06-16 | Phase 5C | Android WebSocket：CollabWebSocket.kt（OkHttp WS + SharedFlow<WsEvent>，pingInterval=20s，DisposableEffect 管理生命周期，页面销毁自动断开） | - |
| 2026-06-16 | Phase 5C | Android 包名清理：旧包 com.example.coraiworkerandr 下所有文件删除，统一使用 com.coraiworker.android | - |
| 2026-06-17 | Phase 6-1a | 后端：agent_memories 表（迁移检测）+ messages.forward_from 字段 + 记忆 CRUD 接口（GET/POST/PUT/DELETE）+ 获取对方 ComMemory 接口 | - |
| 2026-06-17 | Phase 6-1a | 前端：会话列表头像点击弹出联系人小卡片（发消息 / 让 Agent 帮我起草），跳转 /corwork/messages/${peerId}/agent | - |
| 2026-06-17 | Phase 6-1a | 前端：Agent 起草页重构（useAvailableModels 读取真实 API Key，System Prompt 注入对方 ComMemory，快捷提示按钮，模型选择器） | - |
| 2026-06-17 | Phase 6-1b | 后端：forward_message MCP 工具（agent_forward 消息类型 + forward_from 字段 + WebSocket 推送），注册到全局 tool_registry | - |
| 2026-06-17 | Phase 6-1b | 前端：agent_forward 消息特殊气泡（紫色渐变 + Sparkles 头像 + 「TA 的 Agent 转发」标签） | - |
| 2026-06-17 | Phase 6-1c | 前端：MemoryDrawer 组件（右侧抽屉，按 soul/memory/user/common 分组，新建/编辑/删除，内联表单，二次确认删除） | - |
| 2026-06-17 | Phase 6-1c | 前端：消息对话页顶部栏新增「记忆」按钮（绿色 Brain 图标），点击打开 MemoryDrawer | - |
| 2026-06-17 | Phase 6-1c | 后端：save_memory MCP 工具（写入 agent_memories 表，支持 soul/memory/user/common 四种类型），注册到全局 tool_registry | - |
| 2026-06-17 | Phase 6-1c | 后端：skill_store 新增 ForwardMessage / SaveMemory 协作 Skill 种子数据（collab 类型），seed_builtin_skills 查询条件扩展为 IN ('builtin','collab') | - |
| 2026-06-17 | Phase 6-1c | 后端：skill_runner.load_enabled_skills 跳过 collab 类型（与 builtin 同等处理，避免沙箱 exec 报 __import__ not found） | - |
| 2026-06-17 | Phase 6-1c | 后端：ChatRequest 新增 tool_names 字段（null=全部，[]=禁用，list=白名单），agent_service 按此过滤工具列表 | - |
| 2026-06-17 | Phase 6-1c | 前端：use-enabled-skill-tools.ts Hook，从后端拉取已启用 Skill，排除 collab 类型，返回工具名白名单 | - |
| 2026-06-17 | Phase 6-1c | 前端：Chat 页面发请求时传 tool_names（只包含 Skill 中心启用的普通工具，协作工具不暴露给普通 Chat） | - |
| 2026-06-17 | Phase 6-1c | 前端：Skill 看板新增 collab 类型支持（绿色主题 + Users 图标 + 「协作」徽章 + 不可删除） | - |
| 2026-06-17 | Phase 7A | 后端：workspace_service.py（workspace_root 安全边界，resolve_path 路径前缀校验，build_file_tree 忽略 node_modules/.git/__pycache__，最多 500 文件） | - |
| 2026-06-17 | Phase 7A | 后端：file_tools.py（list_dir/read_file/write_file 三个 MCP 工具，注册到 tool_registry，read_file 支持 start_line/end_line 分段读取，超 200KB 提示分段） | - |
| 2026-06-17 | Phase 7A | 后端：api/v1/workspace.py（POST /v1/workspace/open + GET /v1/workspace/info + GET /v1/workspace/tree + GET /v1/workspace/file + PUT /v1/workspace/file） | - |
| 2026-06-17 | Phase 7B | 前端：/workbench/editor 页面完整重写为三栏布局（文件树 w-52 + Monaco 编辑器 flex-1 + Agent 对话区 w-80），类 Cursor 风格 | - |
| 2026-06-17 | Phase 7B | 前端：FileTreeNode 递归组件（目录可折叠，depth<2 默认展开，点击文件加载到编辑器，激活文件高亮） | - |
| 2026-06-17 | Phase 7B | 前端：Monaco 编辑器（vs-dark 主题，JetBrains Mono 字体，Tab 栏未保存 ● 标记，Cmd+S 保存，15 种语言自动识别） | - |
| 2026-06-17 | Phase 7B | 前端：Agent 对话区（模型选择器，工具调用卡片 ToolCallCard，write_file 完成后自动刷新编辑器，快捷提示按钮） | - |
| 2026-06-17 | Phase 7B | 前端：tool_names 白名单（list_dir/read_file/write_file/web_search/get_debug_snapshot/set_breakpoint/wait_for_breakpoint），不暴露协作工具 | - |
| 2026-06-17 | Phase 7C | 后端：api/v1/debug_bridge.py（POST /v1/debug/snapshot 接收快照，deque(maxlen=20) 缓存，GET /v1/debug/snapshot/latest，POST /v1/debug/recommend 转发给 AS 18766 端口） | - |
| 2026-06-17 | Phase 7C | 后端：tools/debug_tools.py（get_debug_snapshot/set_breakpoint/wait_for_breakpoint 三个 MCP 工具，兼容单断点/多断点 diff 两种快照格式） | - |
| 2026-06-17 | Phase 7C | 前端：DebugPanel 组件（可折叠，等待状态脉冲动画，快照展示含变量 Tab/调用栈 Tab，多断点 diff 格式支持，每 5 秒轮询刷新） | - |
| 2026-06-17 | Phase 7C | 前端：wait_for_breakpoint 工具调用联动（Agent 调用时激活等待状态，完成后关闭并刷新快照），底部状态栏断点指示 | - |
| 2026-06-17 | Phase 7C | 前端：输入框解除工作区限制（调试场景无需文件树也可与 Agent 对话），System Prompt 补充调试工具说明 | - |
| 2026-06-17 | Phase 7D | 前端：拖拽文件夹打开工作区（dragenter/dragleave/dragover/drop 四事件，dragCounterRef 计数器解决子元素抖动，优先 File System Access API getAsFileSystemHandle，降级 webkitGetAsEntry） | - |
| 2026-06-17 | Phase 7D | 前端：系统原生文件夹选择器（showDirectoryPicker，File System Access API），openDirHandle 统一处理拖拽和点击两种入口 | - |
| 2026-06-17 | Phase 7D | 后端：GET /v1/workspace/locate 接口，扫描 /Users、/home 下常见路径（深度 2 层），按文件夹名搜索返回候选路径列表 | - |
| 2026-06-17 | Phase 7D | 前端：openDirHandle 调用 locate 接口自动填充完整路径；唯一匹配时零操作自动完成，多候选时弹 banner 让用户确认 | - |
| 2026-06-17 | Phase 7D | 前端：Agent Diff 视图（MonacoDiffEditor 并排对比，汇总栏显示 +N/-N 行数，逐文件接受/拒绝，全部接受/拒绝，拒绝时 revertFileToDisk 写回磁盘） | - |
| 2026-06-17 | Phase 7D | 前端：buildSystemPrompt 注入当前断点快照状态（有快照时强制提示调用工具，无快照时说明暂无），修复 Agent 凭记忆回答「没有断点」的问题 | - |
| 2026-06-17 | Phase 7D | 前端：openDirHandle 和 handleExpandDir 改为递归读取完整目录树（readFullTree），修复文件树只显示一层、子目录显示「空目录」的问题 | - |
| 2026-06-17 | Phase 7D | 工程：plugins/debuggerPlugin/ 目录新增，将 Android Studio 断点调试插件源码纳入 Cor-AiWorker 仓库统一管理；更新 .gitignore 忽略 build/、.gradle/、.kotlin/ 等编译产物 | - |
| 2026-06-17 | Phase 7D | 前端：拖拽文件夹打开工作区（dragenter/dragleave/dragover/drop 四事件，dragCounterRef 计数器解决子元素抖动，优先 File System Access API getAsFileSystemHandle，降级 webkitGetAsEntry） | - |
| 2026-06-17 | Phase 7D | 前端：系统原生文件夹选择器（showDirectoryPicker，File System Access API），openDirHandle 统一处理拖拽和点击两种入口 | - |
| 2026-06-17 | Phase 7D | 后端：GET /v1/workspace/locate 接口，扫描 /Users、/home 下常见路径（深度 2 层），按文件夹名搜索返回候选路径列表 | - |
| 2026-06-17 | Phase 7D | 前端：openDirHandle 调用 locate 接口自动填充完整路径；唯一匹配时零操作自动完成，多候选时弹 banner 让用户确认 | - |
| 2026-06-17 | Phase 7D | 前端：Agent Diff 视图（MonacoDiffEditor 并排对比，汇总栏显示 +N/-N 行数，逐文件接受/拒绝，全部接受/拒绝，拒绝时 revertFileToDisk 写回磁盘） | - |
| 2026-06-17 | Phase 7D | 前端：buildSystemPrompt 注入当前断点快照状态（有快照时强制提示调用工具，无快照时说明暂无），修复 Agent 凭记忆回答「没有断点」的问题 | - |
| 2026-06-17 | Phase 7D | 前端：openDirHandle 和 handleExpandDir 改为递归读取完整目录树（readFullTree），修复文件树只显示一层、子目录显示「空目录」的问题 | - |
| 2026-06-17 | Phase 7D | 工程：plugins/debuggerPlugin/ 目录新增，将 Android Studio 断点调试插件源码纳入 Cor-AiWorker 仓库统一管理；更新 .gitignore 忽略 build/、.gradle/、.kotlin/ 等编译产物 | - |

---

## Phase 8 及后续迭代

Phase 7 完成后，后续小功能迭代记录在子文档中：

👉 **[iteration-log-v2.md](./iteration-log-v2.md)**
