"""按预设创建 Provider。API Key 由调用方从钥匙串读取后传入，内核不接触存储。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .anthropic import AnthropicProvider
from .base import Provider
from .openai_compat import OpenAICompatProvider

ProtocolKind = Literal["anthropic", "openai_compat"]


@dataclass(frozen=True)
class ProviderPreset:
    protocol: ProtocolKind
    default_model: str
    base_url: str | None = None


PRESETS: dict[str, ProviderPreset] = {
    "anthropic": ProviderPreset("anthropic", "claude-opus-5-5"),
    "deepseek": ProviderPreset("openai_compat", "deepseek-v4-pro", "https://api.deepseek.com"),
}


def create_provider(
    name: str, *, api_key: str, model: str | None = None, base_url: str | None = None
) -> Provider:
    preset = PRESETS.get(name)
    if preset is None:
        raise ValueError(f"未知的模型提供方：{name}（可选：{', '.join(PRESETS)}）")
    model = model or preset.default_model
    if preset.protocol == "anthropic":
        return AnthropicProvider(api_key=api_key, model=model, name=name)
    url = base_url or preset.base_url
    if url is None:
        raise ValueError(f"{name} 需要提供 base_url")
    return OpenAICompatProvider(name=name, api_key=api_key, base_url=url, model=model)
