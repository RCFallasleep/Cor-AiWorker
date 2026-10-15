"""Harness 内核：Agent 循环、模型适配器、工具、权限与上下文。

内核是纯逻辑层，不依赖 HTTP 与数据库；需要外部能力时通过 Protocol 声明，
由应用层注入实现（见 docs/ARCHITECTURE.md 第一章）。
"""
