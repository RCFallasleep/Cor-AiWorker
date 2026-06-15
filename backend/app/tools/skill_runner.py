"""Skill 动态执行器。

将用户自建 Skill（存储在 skill_store 中的 .py 文件）动态注册到 tool_registry。

执行策略：
- 每个 Skill 的 .py 文件被合并后在隔离的 exec 沙箱中执行
- 沙箱暴露有限的内置函数（无 open/os/subprocess 等危险操作）
- Skill 必须定义一个与 Skill name（snake_case）同名的异步函数作为入口
- 入口函数的 docstring 作为工具描述，参数注解作为 JSON Schema

注意：当前为开发阶段，沙箱隔离较宽松。生产环境建议使用 Docker/gVisor 隔离。
"""
from __future__ import annotations

import ast
import inspect
import json
import logging
import re
import textwrap
from typing import Any

from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)

# 已注册的 Skill ID 集合（用于避免重复注册）
_registered_skill_ids: set[str] = set()


def _to_snake_case(name: str) -> str:
    """将 Skill 名称转换为 snake_case 函数名。"""
    s = re.sub(r"[\s\-]+", "_", name.strip())
    s = re.sub(r"[^\w]", "", s)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", s)
    s = re.sub(r"([a-z\d])([A-Z])", r"\1_\2", s)
    return s.lower()


def _extract_function_schema(func_name: str, source: str) -> dict | None:
    """从 Python 源码中提取函数的参数信息，生成 JSON Schema。

    只处理简单类型注解：str, int, float, bool。
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name != func_name:
            continue

        properties: dict[str, dict] = {}
        required: list[str] = []

        args = node.args
        # 计算有默认值的参数数量
        defaults_offset = len(args.args) - len(args.defaults)

        for i, arg in enumerate(args.args):
            if arg.arg in ("self", "cls"):
                continue
            param_name = arg.arg
            # 类型注解
            py_type = "string"
            if arg.annotation:
                ann = ast.unparse(arg.annotation)
                type_map = {"str": "string", "int": "integer", "float": "number", "bool": "boolean"}
                py_type = type_map.get(ann, "string")

            properties[param_name] = {"type": py_type}

            # 有默认值则非必填
            if i < defaults_offset:
                required.append(param_name)

        return {
            "type": "object",
            "properties": properties,
            "required": required,
        }

    return None


def register_skill_as_tool(skill_id: str, skill_name: str, description: str, py_sources: list[str]) -> bool:
    """将 Skill 的 Python 源码动态注册为 tool_registry 中的工具。

    Args:
        skill_id: Skill 的唯一 ID
        skill_name: Skill 名称（用于生成函数名）
        description: Skill 描述（作为工具描述）
        py_sources: 所有 .py 文件内容列表（按顺序合并执行）

    Returns:
        True 表示注册成功，False 表示失败
    """
    if not py_sources:
        logger.warning("skill has no .py files, skip registration | id=%s", skill_id)
        return False

    func_name = _to_snake_case(skill_name)
    combined_source = "\n\n".join(py_sources)

    # 提取参数 schema
    schema = _extract_function_schema(func_name, combined_source)
    if schema is None:
        # 降级：使用通用 schema（接受任意 kwargs）
        schema = {
            "type": "object",
            "properties": {
                "input": {"type": "string", "description": "工具输入"},
            },
            "required": ["input"],
        }
        logger.warning(
            "skill: could not extract schema for func '%s', using generic schema | id=%s",
            func_name, skill_id,
        )

    # 构建沙箱命名空间（限制危险内置函数）
    safe_builtins = {
        k: v for k, v in __builtins__.items()  # type: ignore[union-attr]
        if k not in ("open", "exec", "eval", "compile", "__import__", "breakpoint")
    } if isinstance(__builtins__, dict) else {
        k: getattr(__builtins__, k)
        for k in dir(__builtins__)
        if k not in ("open", "exec", "eval", "compile", "__import__", "breakpoint")
    }

    namespace: dict[str, Any] = {"__builtins__": safe_builtins}

    try:
        exec(compile(combined_source, f"<skill:{skill_id}>", "exec"), namespace)  # noqa: S102
    except Exception as exc:
        logger.error("skill exec failed | id=%s error=%s", skill_id, exc, exc_info=True)
        return False

    func = namespace.get(func_name)
    if func is None:
        logger.error(
            "skill: entry function '%s' not found after exec | id=%s", func_name, skill_id
        )
        return False

    if not (inspect.iscoroutinefunction(func) or callable(func)):
        logger.error("skill: '%s' is not callable | id=%s", func_name, skill_id)
        return False

    # 包装为异步 handler
    if inspect.iscoroutinefunction(func):
        async def _async_handler(**kwargs: Any) -> str:
            result = await func(**kwargs)
            return str(result) if result is not None else ""
        handler = _async_handler
    else:
        import asyncio
        async def _sync_handler(**kwargs: Any) -> str:
            result = await asyncio.get_event_loop().run_in_executor(None, lambda: func(**kwargs))
            return str(result) if result is not None else ""
        handler = _sync_handler

    # 工具名：skill_{snake_name}（避免与内置工具冲突）
    tool_name = f"skill_{func_name}"

    tool_def = ToolDefinition(
        name=tool_name,
        description=description or f"用户自建 Skill：{skill_name}",
        parameters=schema,
        handler=handler,
    )
    tool_registry.register(tool_def)
    _registered_skill_ids.add(skill_id)
    logger.info("skill registered as tool | id=%s tool_name=%s", skill_id, tool_name)
    return True


def unregister_skill_tool(skill_id: str, skill_name: str) -> None:
    """从 tool_registry 中注销 Skill 对应的工具。"""
    func_name = _to_snake_case(skill_name)
    tool_name = f"skill_{func_name}"
    tool_registry.unregister(tool_name)
    _registered_skill_ids.discard(skill_id)
    logger.info("skill unregistered | id=%s tool_name=%s", skill_id, tool_name)


def load_enabled_skills() -> int:
    """从 skill_store 加载所有启用的 Skill 并注册到 tool_registry。

    返回成功注册的数量。
    """
    from app.services import skill_store  # 避免循环导入

    skills = skill_store.list_skills(enabled_only=True)
    count = 0
    for skill in skills:
        if skill.skill_type == "builtin":
            # 内置 Skill 已通过 search.py 等模块直接注册，跳过
            continue
        py_sources = [f.content for f in skill.files if f.language == "python"]
        if not py_sources:
            continue
        ok = register_skill_as_tool(
            skill_id=skill.id,
            skill_name=skill.name,
            description=skill.description,
            py_sources=py_sources,
        )
        if ok:
            count += 1

    logger.info("load_enabled_skills: registered %d custom skills", count)
    return count
