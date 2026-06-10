# Cor-AiWorker 迭代进度日志

> 项目名称：Cor-AiWorker  
> 项目定位：基于多 Agent 协作的团队开发对齐系统  
> 技术选型：Web 前端 Next.js 14 + React + TypeScript + Tailwind CSS + shadcn/ui / 后端 Python + FastAPI + LangChain / 客户端 Android（Compose，按需）

---

## 当前阶段：Phase 1 — 前端 UI 框架搭建

**状态**：进行中  
**开始时间**：2026-06-10  
**完成时间**：-

### 本阶段目标
- [x] 前端脚手架搭建（Next.js 14 App Router + TypeScript + Tailwind CSS）
- [x] 安装 UI 依赖（shadcn/ui、lucide-react）
- [x] 全局布局框架（侧边栏 + 顶部导航栏 + 内容区）
- [x] 侧边栏组件（分组导航、折叠动画、响应式自动折叠）
- [x] 顶部导航栏（面包屑导航、主题切换 Toggle、通知/设置图标）
- [x] 全局主题系统（暗色/亮色切换，CSS 变量驱动，平滑过渡动画）
- [x] 所有路由页面占位（/chat、/chat/history、/corwork、/workbench/* 等共 9 个路由）
- [x] 品牌图标设计（递归三层等边三角形 SVG，几何射线构造）
- [x] 响应式适配（窗口 < 900px 自动折叠侧边栏，< 600px 最小宽度保护）
- [ ] 完成后端脚手架搭建（FastAPI + LangChain）
- [ ] 配置开发环境（Docker Compose / 本地环境）
- [ ] 前后端联调基础接口

---

## 已完成阶段

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

### Phase 2 — 核心功能：ChatAgent
- ChatAgent 对话界面（消息列表、输入框、流式输出）
- 本地用户记忆存储（IndexedDB）
- 对话记录持久化
- 多会话管理
- 接入后端 LLM API

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
