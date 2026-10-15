# cor-aiworker（本地服务）

Cor-AiWorker v2 的本地服务：Harness 内核、存储与 HTTP API。项目说明见仓库根目录 [README](../README.md)，设计见 [架构文档](../docs/ARCHITECTURE.md)。

## 使用

在 `server/` 目录下（或安装后直接用 `cor-aiworker`）：

```bash
# 1. 配置 API Key（交互输入、不回显，存入系统钥匙串）
uv run cor-aiworker key set deepseek
uv run cor-aiworker key set anthropic
uv run cor-aiworker key list

# 2. 可选：添加 MCP 服务（重启本地服务后生效）
uv run cor-aiworker mcp add fetch -- uvx mcp-server-fetch
uv run cor-aiworker mcp list

# 3a. 在终端中对话（审批时会在终端询问）
uv run cor-aiworker chat --provider deepseek
uv run cor-aiworker chat --session <会话 id>        # 继续已有会话

# 3b. 或启动本地服务（HTTP API，仅监听 127.0.0.1）
uv run cor-aiworker serve                  # 默认端口 8765；--port 0 随机
```

`serve` 启动后，端口与访问令牌写在数据目录的 `server.json` 中（仅当前用户可读），接口文档位于 `http://127.0.0.1:端口/api/docs`。

数据目录默认为 `~/Library/Application Support/cor-aiworker`（macOS），可用环境变量 `COR_AIWORKER_DATA_DIR` 覆盖。同一数据目录同时只能运行一个 `serve` 或 `chat`。

## 开发

```bash
uv sync                    # 安装依赖
uv run pytest              # 测试（不调用真实模型，不需要 API Key）
uv run ruff check .        # 规范与安全检查
uv run ruff format .       # 格式化
uv run mypy                # 类型检查
```

## 目录

```
src/cor_aiworker/
├── kernel/      内核：Agent 循环、模型适配器、工具与 MCP、权限、上下文
├── storage/     SQLite、迁移、数据访问
├── app/         应用层：运行管理、会话服务、组装入口（Runtime）
├── api/         HTTP API 与本地安全防护
├── cli.py       命令行入口
├── config.py    数据目录等配置
├── keystore.py  系统钥匙串
└── instance.py  单实例锁
spikes/          技术验证（历史参考，不再维护）
```
