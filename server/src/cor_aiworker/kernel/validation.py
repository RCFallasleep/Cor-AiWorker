"""工具参数校验：模型生成的参数是不可信输出，执行前必须按 schema 校验。"""

from __future__ import annotations

import json
from typing import Any

import jsonschema

from .types import JSON


def validate_arguments(arguments: Any, schema: JSON) -> JSON | None:
    """参数合法时返回 dict，否则返回 None（循环会把它转成错误结果回传给模型）。"""
    if not isinstance(arguments, dict):
        return None
    try:
        jsonschema.validate(arguments, schema)
    except jsonschema.ValidationError:
        return None
    return arguments


def parse_arguments(raw: str, schema: JSON) -> JSON | None:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return None
    return validate_arguments(parsed, schema)
