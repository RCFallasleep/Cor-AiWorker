# Cor-AiWorker

一个支持 Agent 自循环、联网搜索、行为日志可视化的 AI 对话工作台。

## 核心功能

- **ReAct Agent 自循环**：LLM 自主决策 → 调用工具 → 观察结果 → 继续推理，最多 10 轮
- **联网搜索**：集成 SearXNG 聚合搜索，结果自动提炼（压缩 ~70% token）
- **流式输出**：SSE 实时推送思考过程、工具调用、最终回复
- **Agent 流程图**：横向可视化每轮工具调用，同名工具自动折叠并支持展开
- **行为日志系统**：记录每次 Agent 执行的轮次、token 用量、工具调用详情，SQLite 持久化
- **防循环保护**：连续重复工具调用自动检测并打断，避免无效循环

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 16 + React 19 + TypeScript |
| 后端 | FastAPI + Python 3.12 + aiosqlite |
| 搜索 | SearXNG（自托管，聚合多搜索引擎） |
| 存储 | SQLite（Agent 行为日志持久化） |
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
- 后端 API：http://localhost:8000
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

### 模式二：全 Docker 部署（换设备 / 生产环境）

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

### 停止服务

```bash
# 停止（保留数据）
docker compose --profile deploy stop

# 停止并删除容器
docker compose --profile deploy down
```

---

## 项目结构

```
Cor-AiWorker/
├── frontend/          # Next.js 前端
│   ├── app/           # 页面（App Router）
│   ├── components/    # UI 组件
│   ├── lib/           # hooks、工具函数、数据库
│   ├── Dockerfile     # 前端 Docker 镜像
│   └── .env.example   # 环境变量示例
├── backend/           # FastAPI 后端
│   ├── app/
│   │   ├── api/       # 路由（/v1/chat、/v1/agent/chat、/v1/logs）
│   │   ├── services/  # 业务逻辑（chat、agent 自循环、log_store）
│   │   ├── tools/     # 工具注册表 + 联网搜索工具
│   │   ├── schemas/   # Pydantic 数据模型
│   │   └── core/      # 配置、日志
│   └── Dockerfile     # 后端 Docker 镜像
├── data/              # SQLite 持久化目录（Docker volume 挂载）
│   └── agent_logs.db  # Agent 行为日志数据库（自动创建）
├── searxng/
│   └── settings.yml   # SearXNG 配置（开启 json 格式）
└── docker-compose.yml # 服务编排
```

---

## 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看后端日志
docker logs cor-backend -f

# 查看 SearXNG 日志
docker logs cor-searxng -f

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
| `DEBUG` | 调试模式 | `false` |
| `LOG_DB_PATH` | Agent 日志 SQLite 数据库路径 | `/data/agent_logs.db` |

---

## 页面说明

| 路径 | 说明 |
|------|------|
| `/` | 主对话页面，支持 Agent 模式与普通对话切换 |
| `/settings/logs` | Agent 行为日志页面，查看历史执行记录、轮次详情、工具调用 |

---

## Agent 行为说明

### 执行流程

1. 用户发送消息 → 后端创建 `AgentRunLog` 记录
2. LLM 推理 → 决定调用工具或直接回复
3. 工具调用（如 `web_search`）→ 结果提炼后注入上下文
4. 循环直到 LLM 输出最终回复（`finish_reason=stop`）或达到最大轮次（10 轮）
5. 执行结束 → 持久化到 SQLite

### 防护机制

- **连续重复工具调用检测**：同一工具连续调用 ≥ 3 次时，自动注入打断消息，避免无效循环
- **搜索结果提炼**：每条搜索结果摘要限制 120 字符，最多 5 条，压缩约 70% token 用量
- **最大循环次数**：默认 10 轮，超出后强制终止并记录 `error` 状态

### 日志 API

```
GET /v1/logs/              # 查询执行记录列表（支持 session_id 筛选、分页）
GET /v1/logs/{run_id}      # 查询单条执行记录详情（含完整轮次和工具调用）
```
