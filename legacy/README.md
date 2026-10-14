# Cor-AiWorker

> ⚠️ **这是 v1（学年设计原型版）的归档，仅作参考，不再维护。** v2 重构方案见 [docs/PRD-v2.md](../docs/PRD-v2.md)。
>
> v1 存在未修复的安全问题（未鉴权的代码执行与文件读写、CORS 放开等），**请勿在不可信网络中运行**。如需运行，下文所有命令均在 `legacy/` 目录下执行。

基于多 Agent 协作的团队开发对齐系统。支持本地代码编辑、Agent 文件操作、Android Studio 断点调试闭环、多 Agent 并行推演、团队协作消息等功能。

## 核心功能

### 代码编辑 & Agent 辅助（`/workbench/editor`）
- **三栏布局**：文件树 + Monaco 编辑器 + Agent 对话区，类 Cursor 风格
- **拖拽 / 选择文件夹**：支持从 Finder 直接拖入，或点击选择器打开，路径自动填充
- **Agent 文件操作**：Agent 可直接读写工作区文件（`list_dir` / `read_file` / `write_file` MCP 工具）
- **Diff 视图**：Agent 修改文件后展示 MonacoDiffEditor 并排对比，支持逐文件接受 / 拒绝
- **断点调试闭环**：与 Android Studio debuggerPlugin 联动，Agent 可读取断点快照、推荐断点、等待调试结果

### 多 Agent 推演（`/corwork/think-tank`）
- **星图可视化**：节点拖拽、有向连线、实时 token 粒子流动动画
- **图推演模式**：多 Agent 并行推理，拓扑排序依赖调度
- **研讨会模式**：多轮动态研讨，组织者自主裁判决定是否继续（最多 5 轮）
- **存档系统**：推演完成自动保存，历史侧边栏可恢复

### 团队协作（`/corwork/messages`）
- **实时消息**：WebSocket 长连接，好友申请系统，未读角标
- **Agent 代理**：让 Agent 帮你起草消息，以「Agent 转发」身份发送给对方
- **Agent 记忆**：四层记忆体系（灵魂设定 / 工作记忆 / 用户记忆 / 公共记忆），跨 Agent 共享
- **Android 客户端**：Jetpack Compose，消息列表 + 聊天页 + WebSocket 实时接收

### AI 对话（`/chat`）
- **ReAct Agent 自循环**：LLM 自主决策 → 调用工具 → 观察结果 → 继续推理
- **联网搜索**：集成 SearXNG，结果自动提炼（压缩 ~70% token）
- **多模态输入**：图片上传、粘贴截图、Word/PDF 文档解析
- **Agent 流程图**：横向可视化每轮工具调用，同名工具自动折叠
- **Skills 中心**：自定义 MCP 工具，动态注册无需重启

### Android Studio 断点插件（`plugins/debuggerPlugin`）
- 监听断点命中，采集变量 / 调用栈快照，POST 到后端
- 轮询后端断点推荐并推送到 Android Studio
- 插件设置页可配置后端地址

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 15 + React + TypeScript + Monaco Editor |
| 后端 | FastAPI + Python 3.12 + aiosqlite |
| 搜索 | SearXNG（自托管，聚合多搜索引擎） |
| 存储 | SQLite（agent_logs.db / corwork.db / skills.db） |
| Android | Jetpack Compose + Retrofit + OkHttp WebSocket |
| AS 插件 | IntelliJ Platform Plugin（Kotlin） |
| 部署 | Docker Compose |

---

## 快速启动

### 前置条件

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（必须）
- Node.js 20+（本地开发前端时需要）

---

### 模式一：本地开发（推荐）

前端本地跑（支持热更新），后端 + SearXNG 用 Docker。

**第一步：启动后端服务**

```bash
docker compose up -d
```

启动后：
- 后端 API：http://localhost:8000（管理面板：http://localhost:8000/v1/admin/）
- SearXNG 搜索：http://localhost:8080

**第二步：启动前端**

```bash
cd frontend
cp .env.example .env.local   # 首次使用时复制配置文件
npm install                   # 首次使用时安装依赖
npm run dev
```

打开 http://localhost:3000 即可使用。

---

### 模式二：全 Docker 部署

所有服务（前端 + 后端 + SearXNG）全部用 Docker 跑，**无需安装 Node.js**。

```bash
docker compose --profile deploy up -d
```

首次构建前端镜像需要几分钟，之后打开 http://localhost:3000 即可使用。

> **注意**：全 Docker 模式下前端代码修改后需要重新构建：
> ```bash
> docker compose --profile deploy up -d --build frontend
> ```

---

### 本地文件系统挂载（代码编辑功能）

使用 `/workbench/editor` 代码编辑功能时，需要将本地目录挂载到容器内，让后端能访问本地文件：

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# 编辑 docker-compose.override.yml，将 /Users 替换为你的实际用户目录
docker compose up -d
```

示例配置见 [`docker-compose.override.yml.example`](docker-compose.override.yml.example)。

---

### 停止服务

```bash
# 停止（保留数据）
docker compose stop

# 停止并删除容器
docker compose down
```

---

## 项目结构

```
Cor-AiWorker/
├── frontend/              # Next.js 前端
│   ├── app/
│   │   ├── chat/          # AI 对话页
│   │   ├── corwork/       # 协作区（消息 / Think Tank / 看板）
│   │   ├── workbench/     # 工作台（代码编辑器 / Skills 中心）
│   │   ├── health/        # Agent 养成
│   │   └── settings/      # 设置（API Key / 日志）
│   ├── components/        # UI 组件
│   ├── lib/               # hooks、工具函数、数据库
│   └── Dockerfile
├── backend/               # FastAPI 后端
│   └── app/
│       ├── api/v1/        # 路由（chat / agent / workspace / debug / collab 等）
│       ├── services/      # 业务逻辑
│       ├── tools/         # MCP 工具（搜索 / 文件 / 调试 / 协作）
│       ├── schemas/       # Pydantic 数据模型
│       └── core/          # 配置、认证、CORS
├── plugins/
│   └── debuggerPlugin/    # Android Studio 断点调试插件（IntelliJ Platform）
├── android/               # Android 示例 App（Jetpack Compose）
├── searxng/
│   └── settings.yml       # SearXNG 配置
├── data/                  # SQLite 持久化目录（Docker volume 挂载，自动创建）
├── docker-compose.yml
├── docker-compose.override.yml.example   # 本地文件系统挂载示例
└── docs/
    ├── iteration-log.md   # 迭代进度日志
    └── PRD.md             # 产品需求文档
```

---

## 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看后端日志
docker logs cor-backend -f

# 重新构建后端（修改后端代码后）
docker compose up -d --build backend

# 重新构建前端（全 Docker 模式下修改前端代码后）
docker compose --profile deploy up -d --build frontend
```

---

## 环境变量说明

### 前端（`frontend/.env.local`）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NEXT_PUBLIC_BACKEND_URL` | 后端地址 | `http://localhost:8000` |

### 后端（`docker-compose.yml` 中配置）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SEARXNG_BASE_URL` | SearXNG 地址 | `http://searxng:8080` |
| `ALLOWED_ORIGINS` | CORS 允许的前端地址（JSON 数组格式） | `["http://localhost:3000"]` |
| `SECRET_KEY` | JWT 签名密钥（协作功能登录用） | 随机字符串 |
| `LOG_DB_PATH` | Agent 日志数据库路径 | `/data/agent_logs.db` |

---

## 页面说明

| 路径 | 说明 |
|------|------|
| `/chat` | AI 对话，支持 Agent 模式、多模态输入、Skills 工具 |
| `/workbench/editor` | 本地代码编辑器，Agent 文件操作，断点调试 |
| `/workbench/skills` | Skills 中心，自定义 MCP 工具管理 |
| `/corwork/messages` | 团队协作消息，Agent 代理起草，好友申请 |
| `/corwork/think-tank` | 多 Agent 并行推演 / 研讨会 |
| `/health/agent` | Agent 养成，LiveBench 能力评分，六维雷达图 |
| `/settings/apikey` | API Key 管理（OpenAI / Anthropic / DeepSeek / Gemini） |
| `/settings/logs` | Agent 行为日志，查看历史执行记录和工具调用详情 |

---

## Android Studio 断点插件

插件源码位于 [`plugins/debuggerPlugin/`](plugins/debuggerPlugin)，使用 IntelliJ Platform Plugin SDK 开发。

**功能**：
- 断点命中时自动采集变量 / 调用栈快照，POST 到 Cor-AiWorker 后端
- 轮询后端 `/v1/debug/recommend` 接口，将 Agent 推荐的断点推送到 Android Studio
- 插件设置页（`Preferences → Tools → AI Debugger`）可配置后端地址

**构建**：

```bash
cd plugins/debuggerPlugin
./gradlew buildPlugin   # 生成 build/distributions/debuggerPlugin-*.zip
```

将生成的 `.zip` 文件通过 Android Studio → `Preferences → Plugins → Install Plugin from Disk` 安装。
