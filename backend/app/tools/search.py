from __future__ import annotations

import logging
import re

import httpx

from app.core.config import settings
from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)

# 每次搜索返回的最大结果条数
_MAX_RESULTS = 5
# 注入给模型的每条结果最大字符数（提炼后）
_MAX_SNIPPET_CHARS = 120


def _extract_key_sentences(text: str, max_chars: int) -> str:
    """从摘要文本中提取信息密度最高的内容注入给模型。

    策略：
    1. 按句子切分（。！？.!?）
    2. 优先保留含数字、日期、温度、地名等关键信息的句子
    3. 去掉明显的导航/广告废话（"点击查看"、"更多内容"等）
    4. 拼接到 max_chars 为止
    """
    if not text:
        return ""

    # 过滤废话模式
    noise_patterns = re.compile(
        r"(点击|查看更多|阅读全文|来源：|转载|版权|广告|订阅|关注|下载|APP|扫码|二维码"
        r"|copyright|read more|click here|subscribe)",
        re.IGNORECASE,
    )

    # 高价值内容模式（含数字、温度、日期、百分比、货币等）
    value_patterns = re.compile(
        r"(\d+[°℃%℉]|\d{4}年|\d+月\d+日|\d+:\d+|[￥$€£]\d+|\d+\.\d+|"
        r"最高|最低|气温|天气|晴|雨|阴|雪|风|湿度|降水|预报)"
    )

    # 按句子切分
    sentences = re.split(r"(?<=[。！？.!?])\s*", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    # 分两组：高价值句 + 普通句（都过滤废话）
    high_value: list[str] = []
    normal: list[str] = []
    for s in sentences:
        if noise_patterns.search(s):
            continue
        if value_patterns.search(s):
            high_value.append(s)
        else:
            normal.append(s)

    # 优先拼接高价值句，不够再补普通句
    result = ""
    for s in high_value + normal:
        if len(result) + len(s) + 1 > max_chars:
            # 剩余空间还能放一部分就截断补上
            remaining = max_chars - len(result)
            if remaining > 20:
                result += s[:remaining]
            break
        result += s + " "

    return result.strip() or text[:max_chars]


async def _web_search_handler(query: str) -> str:
    """调用 SearXNG 实例执行联网搜索，返回提炼后的精简结果。"""
    base_url = settings.searxng_base_url
    if not base_url:
        return "[错误] 未配置 SearXNG 实例地址（SEARXNG_BASE_URL），无法执行联网搜索。"

    params = {
        "q": query,
        "format": "json",
        "language": "zh-CN",
        "safesearch": "1",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{base_url}/search", params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        logger.warning("searxng timeout | query=%s", query)
        return f"[错误] 搜索超时。查询：{query}"
    except httpx.HTTPStatusError as e:
        logger.error("searxng http error | status=%s query=%s", e.response.status_code, query)
        return f"[错误] 搜索服务异常（{e.response.status_code}）。"
    except Exception as e:
        logger.error("searxng error | %s", e, exc_info=True)
        return f"[错误] 搜索失败：{e}"

    results = data.get("results", [])
    if not results:
        return f"未找到「{query}」的相关结果。"

    # 提炼每条结果，只保留信息密度高的内容
    lines = [f"搜索「{query}」："]
    kept = 0
    for r in results:
        if kept >= _MAX_RESULTS:
            break
        title   = r.get("title", "").strip()
        content = r.get("content", "").strip()

        snippet = _extract_key_sentences(content, _MAX_SNIPPET_CHARS)

        # 标题本身就是高价值信息，直接保留
        if title:
            line = f"· {title}"
            if snippet:
                line += f"：{snippet}"
            lines.append(line)
            kept += 1

    logger.debug(
        "web_search | query=%s results_raw=%d results_kept=%d output_chars=%d",
        query, len(results), kept, sum(len(l) for l in lines),
    )

    return "\n".join(lines)


# ── 注册到全局 Tool 注册表 ────────────────────────────────────────────────────

web_search_tool = ToolDefinition(
    name="web_search",
    description=(
        "联网搜索工具。获取实时信息、最新新闻、当前数据时使用。"
        "返回已提炼的关键信息，通常 1 次搜索即可回答问题。"
        "若结果不理想，换不同关键词再搜 1 次，之后直接基于已有信息回答。"
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "搜索关键词，简洁精准，如「重庆 天气 今天」",
            },
        },
        "required": ["query"],
    },
    handler=_web_search_handler,
)

tool_registry.register(web_search_tool)
