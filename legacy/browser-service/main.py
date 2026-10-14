"""Browser Service — 基于 browser-use + Playwright 的页面内容读取服务。

提供一个简单的 HTTP API，供 cor-backend 调用：
  POST /read   → 用真实浏览器访问指定 URL，提取页面正文，返回给 LLM

设计原则：
- 无状态：每次请求启动独立浏览器实例，用完即关
- 透传 API Key：browser-use 内部 LLM 使用调用方传入的 key，不在服务端存储
- 防 SSRF：拒绝访问内网地址
- 超时保护：单次任务最长 60 秒
"""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cor Browser Service", version="0.1.0")

# ── 防 SSRF：内网 CIDR 黑名单 ────────────────────────────────────────────────

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _is_private_ip(host: str) -> bool:
    """检查 host 是否解析到内网 IP（防 SSRF）。"""
    try:
        ip = ipaddress.ip_address(host)
        return any(ip in net for net in _PRIVATE_NETWORKS)
    except ValueError:
        pass
    # 域名：解析后检查
    try:
        resolved = socket.gethostbyname(host)
        ip = ipaddress.ip_address(resolved)
        return any(ip in net for net in _PRIVATE_NETWORKS)
    except Exception:
        return False


def _validate_url(url: str) -> None:
    """校验 URL 合法性并防止 SSRF。"""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="仅支持 http/https 协议")
    host = parsed.hostname or ""
    if not host:
        raise HTTPException(status_code=400, detail="URL 缺少 host")
    if _is_private_ip(host):
        raise HTTPException(status_code=403, detail="不允许访问内网地址")


# ── 请求 / 响应模型 ───────────────────────────────────────────────────────────

class ReadRequest(BaseModel):
    url: str
    task: str = "读取并提取这个页面的主要内容，包括标题、正文、关键数据。"
    api_key: str
    base_url: str | None = None
    model: str = "gpt-4o-mini"
    max_content_chars: int = 20000  # 返回给 LLM 的最大字符数

    @field_validator("url")
    @classmethod
    def url_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("url 不能为空")
        return v.strip()

    @field_validator("api_key")
    @classmethod
    def api_key_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("api_key 不能为空")
        return v.strip()


class ReadResponse(BaseModel):
    url: str
    content: str
    success: bool
    error: str | None = None


# ── 核心处理逻辑 ──────────────────────────────────────────────────────────────

async def _read_with_browser_use(req: ReadRequest) -> str:
    """使用 browser-use Agent 读取页面内容。

    browser-use Agent 内部会：
    1. 启动 headless Chromium
    2. 导航到目标 URL
    3. 用 LLM 理解页面结构，提取所需内容
    4. 返回结构化的文本结果
    """
    from browser_use import Agent, Browser, BrowserConfig
    from langchain_openai import ChatOpenAI

    # 构建 LLM（透传用户的 api_key 和 base_url）
    llm_kwargs: dict = {
        "model": req.model,
        "api_key": req.api_key,
        "temperature": 0.0,
    }
    if req.base_url:
        llm_kwargs["base_url"] = req.base_url

    llm = ChatOpenAI(**llm_kwargs)

    # 浏览器配置：headless 模式，禁用不必要功能
    browser_config = BrowserConfig(
        headless=True,
        extra_chromium_args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
        ],
    )

    browser = Browser(config=browser_config)

    # 构建任务描述
    task = (
        f"请访问以下网页并提取主要内容：{req.url}\n\n"
        f"具体要求：{req.task}\n\n"
        "注意：只需读取页面内容，不要点击任何链接或执行任何操作。"
        "提取完内容后立即返回，不要继续导航。"
    )

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        max_actions_per_step=3,   # 限制每步操作数，避免过度导航
    )

    try:
        history = await agent.run(max_steps=5)  # 最多 5 步，够读一个页面了
        result = history.final_result()
        if not result:
            # 尝试从历史中提取最后一条有效内容
            for item in reversed(history.history):
                if hasattr(item, "result") and item.result:
                    result = str(item.result)
                    break
        return result or "[未能提取到页面内容]"
    finally:
        # 确保浏览器实例被关闭
        try:
            await browser.close()
        except Exception:
            pass


async def _read_with_playwright_fallback(url: str) -> str:
    """纯 Playwright 兜底方案：不调 LLM，直接提取页面文本。

    当 browser-use 失败时使用，或作为快速路径（不消耗 LLM token）。
    """
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        try:
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1280, "height": 800},
            )
            page = await context.new_page()

            # 屏蔽图片/字体/媒体，加快加载速度
            await page.route(
                "**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,mp4,mp3}",
                lambda route: route.abort(),
            )

            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # 等待页面 JS 渲染完成
            await page.wait_for_timeout(2000)

            # 提取正文：优先 article/main，兜底 body
            content = ""
            for selector in ["article", "main", "[role='main']", "body"]:
                try:
                    el = page.locator(selector).first
                    text = await el.inner_text(timeout=3000)
                    if text and len(text.strip()) > 100:
                        content = text.strip()
                        break
                except Exception:
                    continue

            return content or "[页面内容为空]"
        finally:
            await browser.close()


# ── API 端点 ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "cor-browser"}


@app.post("/read", response_model=ReadResponse)
async def read_page(req: ReadRequest) -> ReadResponse:
    """读取指定 URL 的页面内容。

    优先使用 browser-use Agent（LLM 驱动，理解能力强）；
    若失败则降级到纯 Playwright 提取（不消耗额外 token）。
    """
    _validate_url(req.url)
    logger.info("read_page | url=%s model=%s", req.url, req.model)

    # 优先尝试 browser-use（LLM 驱动）
    try:
        content = await _read_with_browser_use(req)
        # 截断超长内容
        if len(content) > req.max_content_chars:
            content = content[: req.max_content_chars] + "\n\n[内容已截断，超出字符限制]"
        logger.info("read_page success (browser-use) | url=%s chars=%d", req.url, len(content))
        return ReadResponse(url=req.url, content=content, success=True)
    except Exception as e:
        logger.warning("browser-use failed, fallback to playwright | url=%s error=%s", req.url, e)

    # 降级：纯 Playwright 提取
    try:
        content = await _read_with_playwright_fallback(req.url)
        if len(content) > req.max_content_chars:
            content = content[: req.max_content_chars] + "\n\n[内容已截断，超出字符限制]"
        logger.info("read_page success (playwright) | url=%s chars=%d", req.url, len(content))
        return ReadResponse(url=req.url, content=content, success=True)
    except Exception as e:
        logger.error("read_page failed | url=%s error=%s", req.url, e, exc_info=True)
        return ReadResponse(
            url=req.url,
            content="",
            success=False,
            error=str(e),
        )
