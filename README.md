# Cor-AiWorker

> 🚧 **v2 重构中**

本地优先的个人 Agent Harness，并让不同用户的本地 Agent 能够安全地交换上下文。

- **一个 API Key 即可使用**：支持国内外主流模型
- **能力通过 MCP 扩展**：平台专注 Agent 运行时质量（权限审批、上下文、记忆、可观测性）
- **默认安全**：只监听本机，危险操作需用户审批
- **跨实例协作**：把卡住的问题连同上下文，经审阅后交给另一位用户的 Agent 接手

## 文档

- [产品需求文档 v2](docs/PRD-v2.md)
- [架构文档](docs/ARCHITECTURE.md)

## 目录

```
Cor-AiWorker/
├── server/     # v2 Python 后端（Harness 内核与本地 API）
├── docs/       # v2 文档
└── legacy/     # v1（学年设计原型版）归档，仅作参考
```

v1 的说明与运行方式见 [legacy/README.md](legacy/README.md)。

## License

待定
