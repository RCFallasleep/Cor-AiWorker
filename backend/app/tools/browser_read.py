"""browser_read 工具 — 用真实浏览器读取网页内容。

与 web_search 的区别：
- web_search：关键词搜索 → 返回多条摘要片段（120字/条），适合"找信息"
- browser_read：访问指定 URL → 返回完整页面正文（最多 8000 字），适合"读页面"

适用场景：
- 用户给出具体 URL，需要读取完整内容
- 目标页面有反爬机制（JS 渲染、UA 检测），httpx 直接请求拿不到内容
- 需要读取动态加载的内容（SPA 页面、懒加载等）

调用链：
  tool_registry.execute("browser_read", args)
    → _browser_read_handler(url, task)
    → HTTP POST cor-browser:7788/read
    → browser-use Agent（Playwright + LLM）
    → 返回页面正文
"""
from __future__ import annotations

import logging

import httpx

from app.core.config import settings
from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)

# 单次读取超时（秒）：browser-use 内部最多 5 步，每步约 10s，留足余量
_TIMEOUT_SECONDS = 90.0


async def _browser_read_handler(
    url: str,
    task: str = "提取页面的标题和主要正文内容",
    api_key: str = "",
    base_url: str = "",
    model: str = "",
) -> str:
    """调用 cor-browser 服务，用真实浏览器读取指定 URL 的内容。

    Args:
        url:      要读取的网页地址（必须是 http/https）
        task:     告诉浏览器 Agent 具体要提取什么内容（可选，有默认值）
        api_key:  LLM API Key，透传给 browser-use 内部使用（由 agent_service 注入）
        base_url: LLM Base URL（可选，用于自定义端点）
        model:    LLM 模型名称（可选，默认 gpt-4o-mini）
    """
    service_url = settings.browser_service_url
    if not service_url:
        return (
            "[错误] 未配置 Browser Service 地址（BROWSER_SERVICE_URL），"
            "无法使用浏览器读取功能。请在 docker-compose.yml 中启动 cor-browser 服务。"
        )

    if not api_key:
        return "[错误] 缺少 API Key，无法驱动浏览器 Agent。"

    payload: dict = {
        "url": url,
        "task": task,
        "api_key": api_key,
        "model": model or "gpt-4o-mini",
    }
    if base_url:
        payload["base_url"] = base_url

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            resp = await client.post(f"{service_url}/read", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        logger.warning("browser_read timeout | url=%s", url)
        return f"[错误] 浏览器读取超时（>{_TIMEOUT_SECONDS}s）。URL：{url}"
    except httpx.HTTPStatusError as e:
        logger.error("browser_read http error | status=%s url=%s", e.response.status_code, url)
        return f"[错误] Browser Service 返回异常（{e.response.status_code}）。"
    except Exception as e:
        logger.error("browser_read error | url=%s error=%s", url, e, exc_info=True)
        return f"[错误] 浏览器读取失败：{e}"

    if not data.get("success"):
        error = data.get("error", "未知错误")
        logger.warning("browser_read failed | url=%s error=%s", url, error)
        return f"[错误] 无法读取页面「{url}」：{error}"

    content = data.get("content", "")
    if not content:
        return f"[提示] 页面「{url}」内容为空，可能需要登录或页面无正文。"

    logger.info("browser_read success | url=%s chars=%d", url, len(content))
    return f"【页面内容】{url}\n\n{content}"


# ── 注册到全局 Tool 注册表 ────────────────────────────────────────────────────

browser_read_tool = ToolDefinition(
    name="browser_read",
    description=(
        "浏览器读取工具。用真实浏览器访问指定 URL，提取完整页面正文（最多 20000 字）。"
        "适用场景：①用户给出具体网址需要读取内容；②目标页面有反爬机制（JS渲染、动态加载）导致普通搜索无法获取完整内容。"
        "与 web_search 的区别：web_search 用于关键词搜索找信息，browser_read 用于读取已知 URL 的完整内容。"
        "【重要】调用成功后直接基于返回内容回答，不要再调用 web_search 补充搜索。"
        "注意：每次调用会启动真实浏览器，耗时约 15-30 秒，请仅在必要时使用。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "要读取的网页完整地址，必须包含 http:// 或 https://",
            },
            "task": {
                "type": "string",
                "description": (
                    "告诉浏览器 Agent 具体要提取什么内容，越具体越好。"
                    "例如：「提取文章标题和正文」「获取商品价格和描述」「读取表格数据」"
                ),
            },
        },
        "required": ["url"],
    },
    handler=_browser_read_handler,
)

tool_registry.register(browser_read_tool)
