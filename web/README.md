# cor-aiworker-web（界面）

Cor-AiWorker 的网页界面：Vite + React + TypeScript。设计见 [架构文档](../docs/ARCHITECTURE.md) 4.9（API）与 4.10（主题与皮肤）。

## 开发

需要同时运行本地服务与开发服务器：

```bash
# 终端 1：本地服务（默认端口 8765）
cd server && uv run cor-aiworker serve

# 终端 2：界面开发服务器
cd web && npm install && npm run dev      # 打开 http://127.0.0.1:5173
```

开发服务器把 `/api` 请求转发给本地服务，浏览器看来与页面同源；访问令牌从数据目录的 `server.json` 读取后注入页面。本地服务重启后刷新页面即可。

## 检查

```bash
npm run check          # 依次执行以下全部检查，CI 中同样执行
npm run typecheck      # TypeScript
npm run lint           # oxlint
npm run check:colors   # 组件中不得写死颜色，颜色只能定义在 src/theme/
npm test               # vitest
```

## 约定

- **颜色只用变量**：组件里写 `var(--accent)`，不写 `#2563eb`，否则换皮肤时这部分不会跟着变。
- **不从外部加载资源**：字体使用系统字体，图标内联；本地优先的应用打开时不应请求外部服务器。
- **类型与后端同步**：`src/api/types.ts` 对应 `server/src/cor_aiworker/api/schemas.py` 与 `kernel/events.py`，修改后端字段时一并修改。

## 目录

```
src/
├── api/          API 客户端、SSE 读取与断线续传、类型
├── theme/        颜色变量、皮肤、外观偏好
├── components/   组件（Logo 等）
└── App.tsx       应用外壳
scripts/
└── check-colors.mjs   硬编码颜色检查
```
