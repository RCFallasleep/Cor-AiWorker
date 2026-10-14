# 后端编码规范

> 适用范围：Cor-AiWorker 后端服务（Python + FastAPI + LangChain）  
> 版本：v1.0  
> 最后更新：2026-06-11

---

## 一、项目目录结构

```
backend/
├── app/
│   ├── api/                  # 路由层（仅做参数校验 + 调用 service）
│   │   ├── __init__.py
│   │   └── v1/
│   │       ├── __init__.py
│   │       └── chat.py       # /v1/chat 路由
│   ├── core/                 # 核心配置与基础设施
│   │   ├── __init__.py
│   │   ├── config.py         # 环境变量读取（pydantic-settings）
│   │   └── cors.py           # CORS 配置
│   ├── services/             # 业务逻辑层（LLM 调用、Agent 编排）
│   │   ├── __init__.py
│   │   ├── chat_service.py   # 普通 Chat 流式调用
│   │   └── agent_service.py  # Agent 自循环编排（后续）
│   ├── tools/                # Tool 注册表（MCP 规范）
│   │   ├── __init__.py
│   │   ├── registry.py       # Tool 注册/注销/查询
│   │   └── search.py         # 联网搜索工具（SearXNG，待接入）
│   ├── schemas/              # Pydantic 数据模型（请求/响应结构）
│   │   ├── __init__.py
│   │   └── chat.py
│   └── main.py               # FastAPI 应用入口
├── tests/                    # 单元测试
│   └── __init__.py
├── .env.example              # 环境变量示例（不提交真实值）
├── .gitignore
├── requirements.txt          # 生产依赖
└── requirements-dev.txt      # 开发依赖（pytest、ruff 等）
```

---

## 二、代码风格

### 2.1 格式化工具

- **Ruff**：统一 lint + format，替代 Black + Flake8
- 行长度限制：**100 字符**
- 字符串引号：**双引号**

### 2.2 类型注解

- 所有函数参数和返回值**必须**有类型注解
- 使用 `from __future__ import annotations` 支持前向引用
- 优先使用 `X | Y` 而非 `Optional[X]`（Python 3.10+）

```python
# ✅ 正确
async def stream_chat(body: ChatRequest) -> AsyncGenerator[str, None]:
    ...

# ❌ 错误
async def stream_chat(body):
    ...
```

### 2.3 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 模块/文件 | `snake_case` | `chat_service.py` |
| 类 | `PascalCase` | `ChatService` |
| 函数/方法 | `snake_case` | `stream_response()` |
| 常量 | `UPPER_SNAKE_CASE` | `MAX_LOOP_COUNT` |
| 私有方法 | `_snake_case` | `_build_messages()` |

---

## 三、FastAPI 分层规范

### 3.1 路由层（`app/api/`）

- **只做**：参数校验、调用 service、返回响应
- **不做**：业务逻辑、直接调用 LLM、数据库操作
- 路由统一加版本前缀：`/v1/`

```python
# app/api/v1/chat.py
@router.post("/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        chat_service.stream(body),
        media_type="text/event-stream",
    )
```

### 3.2 Service 层（`app/services/`）

- 承载所有业务逻辑：LLM 调用、Agent 循环、工具执行
- 返回 `AsyncGenerator` 供路由层包装为 `StreamingResponse`
- 不直接依赖 FastAPI（便于单元测试）

```python
# app/services/chat_service.py
async def stream(body: ChatRequest) -> AsyncGenerator[str, None]:
    async for chunk in _call_llm(body):
        yield f"data: {chunk.model_dump_json()}\n\n"
```

### 3.3 Schema 层（`app/schemas/`）

- 所有请求/响应结构用 **Pydantic v2** 定义
- 字段加 `description`，便于自动生成 OpenAPI 文档

```python
class ChatRequest(BaseModel):
    messages: list[Message] = Field(..., description="对话历史")
    model: str = Field(..., description="模型 ID")
    api_key: str = Field(..., description="API Key")
    base_url: str | None = Field(None, description="自定义 Base URL")
```

---

## 四、SSE 流式响应规范

- `Content-Type: text/event-stream`
- 每条事件格式：`data: <JSON>\n\n`
- 事件类型统一用 `type` 字段区分：

```json
// 内容增量
{"type": "delta", "content": "Hello"}

// 工具调用（Agent 阶段）
{"type": "tool_call", "name": "search", "args": {"query": "..."}}

// 工具结果（Agent 阶段）
{"type": "tool_result", "name": "search", "content": "..."}

// 完成
{"type": "done", "input_tokens": 100, "output_tokens": 200}

// 错误
{"type": "error", "message": "..."}
```

---

## 五、Agent 自循环规范

```python
MAX_LOOP_COUNT = 10  # 最大循环次数，防止无限循环

async def agent_loop(messages, tools, model_client):
    for _ in range(MAX_LOOP_COUNT):
        response = await model_client.call(messages, tools)
        
        if not response.tool_calls:
            # 终止条件：模型不再输出 tool_call
            yield response.content
            break
        
        # 执行工具，将结果追加到消息历史
        for tool_call in response.tool_calls:
            result = await execute_tool(tool_call)
            messages.append(tool_result_message(tool_call, result))
    else:
        # 超出最大循环次数
        yield "[Agent 已达最大循环次数，强制终止]"
```

---

## 六、配置管理

- 所有配置通过**环境变量**注入，使用 `pydantic-settings` 读取
- 敏感信息（API Key 等）**不硬编码**，不提交到 Git
- `.env.example` 提供所有变量的示例和说明

```python
# app/core/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "Cor-AiWorker Backend"
    debug: bool = False
    allowed_origins: list[str] = ["http://localhost:3000"]
    
    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
```

---

## 七、错误处理

- 业务错误统一抛出自定义异常，在路由层捕获转为 HTTP 响应
- SSE 流中的错误通过 `{"type": "error", "message": "..."}` 事件推送，不中断连接

```python
# 全局异常处理
@app.exception_handler(AppException)
async def app_exception_handler(request, exc: AppException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})
```

---

## 八、日志规范

- 使用标准库 `logging`，统一格式：`[时间] [级别] [模块] 消息`
- 生产环境日志级别：`INFO`；开发环境：`DEBUG`
- Agent 循环每次迭代记录 `DEBUG` 日志（循环次数、工具调用名称）

---

## 九、单元测试

- 测试文件放在 `tests/` 目录，文件名 `test_*.py`
- 使用 `pytest` + `pytest-asyncio`
- Service 层函数必须可独立测试（不依赖 FastAPI 上下文）
