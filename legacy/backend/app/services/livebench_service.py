"""
LiveBench 数据服务
- 优先读取内嵌静态 CSV（backend/app/data/livebench_latest.csv）
- 静态文件不存在时，尝试从网络下载最新 CSV（往前推 12 个月）
- 内存缓存，TTL 24h
- 映射到 AgentSkillScores 六维：reasoning / coding / research / writing / math / execution
- 四级匹配策略：精确 → 别名 → 近似（去后缀）→ 默认50分
"""
from __future__ import annotations

import csv
import io
import logging
import re
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# ── 别名映射表：用户常用模型名 → LiveBench CSV 中的实际模型名 ─────────────────
# 当模糊匹配失败时，用此表做最终兜底
_ALIAS_MAP: dict[str, str] = {
    # OpenAI 旧版 → 新版
    "gpt-4o":                   "gpt-5-mini",
    "gpt-4o-mini":              "gpt-5-mini",
    "gpt-4-turbo":              "gpt-5-mini",
    "gpt-4":                    "gpt-5-mini",
    "o1":                       "gpt-5.1-2025-11-13-high",
    "o1-mini":                  "gpt-5-mini",
    "o3":                       "gpt-5.2-2025-12-11-high",
    "o3-mini":                  "gpt-5.2-2025-12-11-low",
    "o4-mini":                  "gpt-5.4-mini",
    # Anthropic 旧版 → 新版
    "claude-3.5-sonnet":        "claude-sonnet-4-5-20250929",
    "claude-3-5-sonnet":        "claude-sonnet-4-5-20250929",
    "claude-3.5-haiku":         "claude-haiku-4-5-20251001",
    "claude-3-haiku":           "claude-haiku-4-5-20251001",
    "claude-3-opus":            "claude-opus-4-5-20251101-medium-effort",
    "claude-3.7-sonnet":        "claude-sonnet-4-5-20250929",
    "claude-opus-4":            "claude-opus-4-5-20251101-medium-effort",
    "claude-sonnet-4":          "claude-sonnet-4-5-20250929",
    "claude-haiku-4":           "claude-haiku-4-5-20251001",
    # claude-sonnet-4-6 系列（带日期后缀的用户填法）
    "claude-sonnet-4-6":                "claude-sonnet-4-6-thinking-auto-medium-effort",
    "claude-sonnet-4-6-20250514":       "claude-sonnet-4-6-thinking-auto-medium-effort",
    "claude-sonnet-4.6":                "claude-sonnet-4-6-thinking-auto-medium-effort",
    "claude-4-sonnet":                  "claude-4-sonnet-20250514-base",
    "claude-4-sonnet-20250514":         "claude-4-sonnet-20250514-base",
    # claude-opus-4-6 / 4-7 系列
    "claude-opus-4-6":                  "claude-opus-4-6-thinking-auto-high-effort",
    "claude-opus-4-7":                  "claude-opus-4-7-medium-effort",
    "claude-opus-4-8":                  "claude-opus-4-8-medium-effort",
    # claude-4-1-opus 系列
    "claude-4-1-opus":                  "claude-4-1-opus-20250805-base",
    "claude-4-1-opus-20250805":         "claude-4-1-opus-20250805-base",
    # DeepSeek 旧版 → 新版
    "deepseek-r1":              "deepseek-v3.2-thinking",
    "deepseek-v3":              "deepseek-v3.2",
    "deepseek-chat":            "deepseek-v3.2",
    "deepseek-coder":           "deepseek-v3.2",
    # Gemini 旧版 → 新版
    "gemini-1.5-pro":           "gemini-2.5-pro-06-05-highthinking",
    "gemini-1.5-flash":         "gemini-2.5-flash-06-05-highthinking",
    "gemini-2.0-flash":         "gemini-2.5-flash-06-05-highthinking",
    "gemini-2.0-pro":           "gemini-2.5-pro-06-05-highthinking",
    "gemini-2.5-flash":         "gemini-2.5-flash-06-05-highthinking",
    "gemini-2.5-pro":           "gemini-2.5-pro-06-05-highthinking",
    # Qwen
    "qwen2.5-72b":              "qwen3.6-plus",
    "qwen2.5-coder":            "qwen3.6-plus",
    "qwen-max":                 "qwen3.7-max",
    # Llama
    "llama-3.1-405b":           "nemotron-3-ultra-550b-a55b",
    "llama-3.1-70b":            "nemotron-3-super-120b-a12b",
    "llama-3.3-70b":            "nemotron-3-super-120b-a12b",
    # Grok
    "grok-2":                   "grok-4.3",
    "grok-3":                   "grok-4.3",
}

# ── 静态数据文件路径 ──────────────────────────────────────────────────────────
_DATA_DIR = Path(__file__).parent.parent / "data"
_STATIC_CSV = _DATA_DIR / "livebench_latest.csv"

# ── 缓存 ──────────────────────────────────────────────────────────────────────
_cache_ts: float = 0.0
_CACHE_TTL = 86400.0  # 24h

# 原始 CSV 行：model -> {column: value}
_raw: dict[str, dict[str, float]] = {}

# ── LiveBench CSV 列名 → AgentSkillScores 字段映射 ────────────────────────────
# CSV 实际列名（已确认，无转义）：
#   AMPS_Hard, code_completion, code_generation, connections, consecutive_events,
#   integrals_with_game, javascript, logic_with_navigation, math_comp, olympiad,
#   paraphrase, plot_unscrambling, python, simplify, spatial, story_generation,
#   summarize, tablejoin, tablereformat, theory_of_mind, typescript, typos, zebra_puzzle

_REASONING_COLS = ["logic_with_navigation", "consecutive_events", "zebra_puzzle", "spatial", "plot_unscrambling", "theory_of_mind"]
_CODING_COLS    = ["code_generation", "code_completion", "python", "javascript", "typescript"]
_MATH_COLS      = ["AMPS_Hard", "math_comp", "olympiad", "integrals_with_game", "simplify"]
_LANGUAGE_COLS  = ["paraphrase", "story_generation", "summarize", "typos"]
_DATA_COLS      = ["tablejoin", "tablereformat", "connections"]


def _norm_col(col: str) -> str:
    """统一列名：去除首尾空格，处理转义下划线。"""
    return col.replace("\\_", "_").strip()


def _col_avg(row: dict[str, float], cols: list[str]) -> float:
    """计算指定列的均值，缺失列跳过。"""
    vals = [row[c] for c in cols if c in row]
    if not vals:
        return 0.0
    return sum(vals) / len(vals)


def _row_to_scores(row: dict[str, float]) -> dict[str, float]:
    """将一行 CSV 数据映射到六维分数（0-100）。"""
    reasoning = _col_avg(row, _REASONING_COLS)
    coding    = _col_avg(row, _CODING_COLS)
    math      = _col_avg(row, _MATH_COLS)
    writing   = _col_avg(row, _LANGUAGE_COLS)
    research  = _col_avg(row, _DATA_COLS)
    execution = (coding + reasoning) / 2

    return {
        "reasoning": round(min(100, max(0, reasoning)), 1),
        "coding":    round(min(100, max(0, coding)),    1),
        "math":      round(min(100, max(0, math)),      1),
        "writing":   round(min(100, max(0, writing)),   1),
        "research":  round(min(100, max(0, research)),  1),
        "execution": round(min(100, max(0, execution)), 1),
    }


def _parse_csv(text: str) -> dict[str, dict[str, float]]:
    """解析 CSV，返回 {model_name: {col: value}} 字典。"""
    result: dict[str, dict[str, float]] = {}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        model = row.get("model", "").strip()
        if not model:
            continue
        scores: dict[str, float] = {}
        for k, v in row.items():
            col = _norm_col(k)
            if col == "model":
                continue
            try:
                scores[col] = float(v)
            except (ValueError, TypeError):
                pass
        result[model] = scores
    logger.debug("LiveBench: parsed %d models from CSV", len(result))
    return result


# ── 数据加载策略 ──────────────────────────────────────────────────────────────

def _load_static() -> Optional[str]:
    """读取内嵌静态 CSV 文件。"""
    if _STATIC_CSV.exists():
        try:
            text = _STATIC_CSV.read_text(encoding="utf-8")
            if "model" in text[:100]:
                logger.info("LiveBench: loaded from static file %s", _STATIC_CSV)
                return text
        except Exception as e:
            logger.warning("LiveBench: failed to read static file: %s", e)
    return None


def _candidate_urls(n_months: int = 12) -> list[str]:
    """生成候选 CSV URL 列表（从当前月往前推 n_months 个月，每月 8 日）。"""
    urls: list[str] = []
    today = date.today()
    for i in range(n_months):
        approx = today - timedelta(days=i * 30)
        d = date(approx.year, approx.month, 8)
        url = f"https://livebench.ai/table_{d.strftime('%Y_%m_%d')}.csv"
        if url not in urls:
            urls.append(url)
    return urls


async def _fetch_from_network() -> Optional[str]:
    """尝试从网络下载最新 CSV。"""
    urls = _candidate_urls(12)
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for url in urls:
            try:
                resp = await client.get(url)
                if resp.status_code == 200 and "model" in resp.text[:200]:
                    logger.info("LiveBench: downloaded from %s", url)
                    # 同时更新本地静态文件
                    try:
                        _DATA_DIR.mkdir(parents=True, exist_ok=True)
                        _STATIC_CSV.write_text(resp.text, encoding="utf-8")
                        logger.info("LiveBench: updated static cache at %s", _STATIC_CSV)
                    except Exception as e:
                        logger.warning("LiveBench: failed to write static cache: %s", e)
                    return resp.text
            except Exception as e:
                logger.debug("LiveBench: URL failed %s: %s", url, e)
    return None


# ── 公开接口 ──────────────────────────────────────────────────────────────────

async def refresh() -> bool:
    """刷新 LiveBench 数据：优先静态文件，失败则网络下载。"""
    global _raw, _cache_ts

    # 1. 优先读静态文件
    text = _load_static()

    # 2. 静态文件不可用时，尝试网络
    if text is None:
        logger.info("LiveBench: static file not available, trying network...")
        text = await _fetch_from_network()

    if text is None:
        logger.warning("LiveBench: no data source available")
        return False

    _raw = _parse_csv(text)
    _cache_ts = time.time()
    logger.info("LiveBench: loaded %d models", len(_raw))
    return True


async def _ensure_loaded() -> None:
    """确保数据已加载（懒加载 + TTL 刷新）。"""
    if not _raw or (time.time() - _cache_ts) > _CACHE_TTL:
        await refresh()


# ── 后缀剥离正则：去掉日期、版本号、effort 等后缀，保留模型核心名 ─────────────
# 例：claude-sonnet-4-6-20250514  →  claude-sonnet-4-6
#     gpt-5.1-2025-11-13-high     →  gpt-5.1
#     deepseek-v4-flash-0324      →  deepseek-v4-flash
_STRIP_SUFFIX_RE = re.compile(
    r"(-\d{8}|-\d{4}-\d{2}-\d{2}|-\d{4}(?=\b|-)|-(?:high|low|medium|minimal|xhigh)"
    r"|-(?:thinking|base|instruct|chat|preview|exp|beta)(?:-\d+k?)?"
    r"|-(?:effort|non-reasoning|reasoning))*$",
    re.IGNORECASE,
)

# 括号内容正则：去掉 (openai) / (anthropic) 等用户备注
_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*")


def _strip_suffix(name: str) -> str:
    """去掉模型名中的日期/版本/effort 后缀，保留核心标识。"""
    return _STRIP_SUFFIX_RE.sub("", name).rstrip("-")


def _normalize(name: str) -> str:
    """
    标准化用户输入的模型名，使其更接近 LiveBench CSV 的格式。
    - 去掉括号内容：claude sonnet 4.6 (openai) → claude sonnet 4.6
    - 空格 → 连字符：claude sonnet 4.6 → claude-sonnet-4.6
    - 点号版本号保留：4.6 → 4.6（不转换，CSV 里也有点号）
    - 小写
    """
    s = name.lower().strip()
    s = _PAREN_RE.sub(" ", s).strip()   # 去括号
    s = re.sub(r"\s+", "-", s)          # 空格转连字符
    return s


def _fuzzy_match(model_name: str) -> tuple[Optional[str], str]:
    """
    四级匹配策略，返回 (matched_key, match_type)。

    match_type:
      "exact"       - 精确匹配（大小写不敏感）
      "alias"       - 别名映射命中
      "fuzzy"       - 子串 / 分词模糊匹配
      "approximate" - 去后缀后近似匹配
    返回 (None, "") 表示完全未找到。
    """
    if not _raw:
        return None, ""

    # 原始小写 + 标准化（去括号、空格转连字符）两个候选
    name_lower = model_name.lower().strip()
    name_norm  = _normalize(model_name)
    # 用于匹配的候选集（去重）
    candidates = list(dict.fromkeys([name_lower, name_norm]))

    # ── 1. 精确匹配（原始 + 标准化两个候选）────────────────────────────────────
    for cand in candidates:
        for key in _raw:
            if key.lower() == cand:
                return key, "exact"

    # ── 2. 别名映射（原始 + 标准化两个候选）────────────────────────────────────
    for cand in candidates:
        alias_target = _ALIAS_MAP.get(cand)
        if alias_target:
            for key in _raw:
                if key.lower() == alias_target.lower():
                    logger.info("LiveBench: alias '%s' -> '%s'", model_name, key)
                    return key, "alias"

    # ── 3. 子串 / 分词模糊匹配（对每个候选都尝试）──────────────────────────────
    for cand in candidates:
        exact_sub: list[str] = []
        key_sub: list[str] = []

        for key in _raw:
            key_lower = key.lower()
            if cand in key_lower:
                exact_sub.append(key)
            elif key_lower in cand:
                key_sub.append(key)

        if exact_sub:
            return min(exact_sub, key=len), "fuzzy"
        if key_sub:
            return max(key_sub, key=len), "fuzzy"

        # 前缀匹配（前 10 字符）
        prefix = cand[:10]
        prefix_matches = [key for key in _raw if key.lower().startswith(prefix)]
        if prefix_matches:
            return min(prefix_matches, key=len), "fuzzy"

        # 分词匹配：按 "-" 分割，匹配包含所有词的 key
        parts = [p for p in cand.split("-") if len(p) > 1]
        if parts:
            scored: list[tuple[int, str]] = []
            for key in _raw:
                key_lower = key.lower()
                match_count = sum(1 for p in parts if p in key_lower)
                if match_count == len(parts):
                    scored.append((match_count, key))
            if scored:
                return min(scored, key=lambda x: len(x[1]))[1], "fuzzy"

    # ── 4. 近似匹配：去掉日期/版本/effort 后缀后重新匹配 ─────────────────────
    for cand in candidates:
        stripped = _strip_suffix(cand)
        if not stripped or stripped == cand:
            continue
        logger.debug("LiveBench: trying approximate match with stripped '%s'", stripped)

        # 4a. 去后缀后精确匹配
        for key in _raw:
            if key.lower() == stripped:
                logger.info("LiveBench: approximate '%s' -> '%s' (stripped)", model_name, key)
                return key, "approximate"

        # 4b. 去后缀后子串匹配
        approx_sub: list[str] = []
        for key in _raw:
            key_stripped = _strip_suffix(key.lower())
            if stripped in key_stripped or key_stripped in stripped:
                approx_sub.append(key)

        if approx_sub:
            best = min(approx_sub, key=len)
            logger.info("LiveBench: approximate '%s' -> '%s' (stripped sub)", model_name, best)
            return best, "approximate"

        # 4c. 去后缀后分词匹配
        stripped_parts = [p for p in stripped.split("-") if len(p) > 1]
        if stripped_parts:
            scored2: list[tuple[int, str]] = []
            for key in _raw:
                key_stripped = _strip_suffix(key.lower())
                match_count = sum(1 for p in stripped_parts if p in key_stripped)
                if match_count >= max(1, len(stripped_parts) - 1):
                    scored2.append((match_count, key))
            if scored2:
                best2 = max(scored2, key=lambda x: x[0])
                logger.info("LiveBench: approximate '%s' -> '%s' (stripped parts)", model_name, best2[1])
                return best2[1], "approximate"

    return None, ""


# 默认分数（完全未找到时使用）
_DEFAULT_SCORES: dict[str, float] = {
    "reasoning": 50.0,
    "coding":    50.0,
    "math":      50.0,
    "writing":   50.0,
    "research":  50.0,
    "execution": 50.0,
}


async def get_model_scores(model_name: str) -> Optional[dict[str, float]]:
    """获取指定模型的六维分数，返回 None 表示未找到（保留旧接口兼容性）。"""
    await _ensure_loaded()
    matched, _ = _fuzzy_match(model_name)
    if matched is None:
        logger.info("LiveBench: model '%s' not found (total %d models)", model_name, len(_raw))
        return None
    row = _raw[matched]
    scores = _row_to_scores(row)
    logger.info("LiveBench: '%s' -> matched '%s' -> %s", model_name, matched, scores)
    return scores


async def get_model_scores_with_meta(model_name: str) -> dict:
    """
    获取模型分数，附带匹配元信息。永远不返回 404，未找到时使用默认50分。

    返回字段：
      reasoning / coding / math / writing / research / execution: float
      matched_model: str | None   实际匹配到的 LiveBench 模型名
      match_type: "exact" | "alias" | "fuzzy" | "approximate" | "default"
    """
    await _ensure_loaded()
    matched, match_type = _fuzzy_match(model_name)

    if matched is None:
        logger.info("LiveBench: '%s' not found, using default scores", model_name)
        return {**_DEFAULT_SCORES, "matched_model": None, "match_type": "default"}

    row = _raw[matched]
    scores = _row_to_scores(row)
    logger.info("LiveBench: '%s' -> '%s' [%s]", model_name, matched, match_type)
    return {**scores, "matched_model": matched, "match_type": match_type}


async def list_models() -> list[str]:
    """返回 LiveBench 中所有模型名列表。"""
    await _ensure_loaded()
    return sorted(_raw.keys())
