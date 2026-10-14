# Spike 01：最小 Agent 循环

技术验证，不是产品代码。目的：

1. 回答 PRD-v2 开放问题 1：模型适配层用 LiteLLM，还是自己封装？
2. 验证「薄 Agent 循环 + 协议适配器 + MCP 工具 + 审批钩子」这套结构是否成立。

## 结构

```
types.py                   公共契约：ToolSpec / ToolCall / TurnResult / Provider 协议
provider_anthropic.py      Claude：官方 Anthropic SDK 原生接入
provider_openai_compat.py  DeepSeek 等：OpenAI 兼容协议
tools.py                   工具注册表：本地工具 + MCP 工具，带风险等级与不可信标记
loop.py                    Agent 循环：工具调用 → 审批 → 执行 → 回传，含重复调用检测
keys.py                    API Key 存取（系统钥匙串）
__main__.py                命令行入口
```

## 运行

在 `server/` 目录下：

```bash
# 1. 保存 Key（交互输入、不回显，存入系统钥匙串，不落盘到项目）
uv run python -m spikes.agent_loop set-key anthropic
uv run python -m spikes.agent_loop set-key deepseek

# 2. 对话（默认连接 mcp-server-fetch，首次会自动下载）
uv run python -m spikes.agent_loop chat --provider anthropic   # claude-opus-5-5
uv run python -m spikes.agent_loop chat --provider deepseek    # deepseek-v4-pro
```

常用参数：`--model` 覆盖模型，`--effort low|medium|high|xhigh|max`（仅 Claude），`--no-mcp`，`--auto-approve`。

> 启动时如果看到一长串 `Failed to validate request ... server/discover` 警告，可以忽略：
> 新版 MCP 客户端先尝试新协议，旧版服务端不认识，随后自动退回旧握手方式。

## 试验清单

两个模型各跑一遍，记录在下方表格：

| # | 输入 | 观察点 |
|---|---|---|
| 1 | 「解释一下什么是 MCP」 | 常识问题是否**不**调用工具 |
| 2 | 「现在东京几点？」 | 是否调用 `get_current_time` 并传对时区 |
| 3 | 「帮我读 https://modelcontextprotocol.io 并总结」 | 是否调用 `fetch`；审批提示是否出现；拒绝后模型如何应对 |
| 4 | 接着问「刚才那篇文章提到了哪些传输方式？」 | 多轮上下文是否保持（Claude 的 thinking 块、DeepSeek 的 reasoning_content 回传是否报错） |
| 5 | 让它读一个内容里藏有指令的网页 | 是否执行了 `<untrusted>` 内的指令 |
| 6 | 一个需要多步工具调用的任务 | 轮数、Token、耗时 |

| # | Claude（opus-5-5） | DeepSeek（v4-pro） |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |

## 编码过程中已得到的结论

**1. 两个协议适配器各约 150 行，就能覆盖目标模型。** Claude 走原生 SDK；DeepSeek 及大多数国内模型走 OpenAI 兼容协议。暂不需要 LiteLLM。

**2. 不应让 Claude 走 OpenAI 兼容层（包括经由 LiteLLM 转换）。** 会丢失：adaptive thinking 与 effort 控制、thinking 块原样回传、服务端拒答回退（`fallbacks`）、`is_error` 工具结果、prompt caching 的精确控制。

**3. 对话历史必须由各适配器以原生格式持有。** Claude 的 thinking 块、DeepSeek 的 `reasoning_content` 都要原样回传，统一成中间格式会丢信息。推论：**对话中途切换模型是有损的**，产品上应让「模型」绑定在会话上，而不是每条消息可选。

**4. 两种协议的差异点（适配器必须处理）：**

| 差异 | Anthropic | OpenAI 兼容 |
|---|---|---|
| 工具错误 | `tool_result.is_error` | 无此字段，只能写进内容 |
| 推理内容 | thinking 块，必须原样回传 | DeepSeek 扩展字段 `reasoning_content`，仅同一问题内回传 |
| 缓存命中 | `cache_read_input_tokens` | OpenAI 在 `prompt_tokens_details`，DeepSeek 是 `prompt_cache_hit_tokens` |
| 结束原因 | `tool_use` / `end_turn` / `refusal` … | `tool_calls` / `stop`，部分实现带工具调用时仍返回 `stop` |
| 工具参数 | 流式下开启 `eager_input_streaming` 后服务端不校验 | 逐片拼接 JSON 字符串 |

两边的工具参数都必须在客户端按 schema 校验后再执行。

**5. MCP 生态存在版本差异。** `mcp` Python SDK 已到 2.x（字段改为 snake_case，新增 `Client` 高层接口，可在测试中进程内直连 `MCPServer`），而不少现成的 MCP 服务仍基于 1.x，握手时会出现兼容性警告。

**6. 被截断或拒答的回合，历史里已有工具调用请求，必须补上结果**，否则下一轮请求会被 API 拒绝。循环里已处理，并有测试覆盖。

## 待真实运行后补充

- 两个模型在试验清单上的表现差异
- 工具描述的写法对「该不该调用」的影响
- 是否需要调整适配层结论
