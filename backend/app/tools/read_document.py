"""内置工具：read_document

让 Agent 按需读取用户上传的文档内容（分块读取，支持大文件）。
注册到全局 tool_registry，工具名：read_document。
"""
from __future__ import annotations

import logging

from app.tools.registry import ToolDefinition, tool_registry

logger = logging.getLogger(__name__)


async def _read_document_handler(file_id: str, chunk_index: int = 0) -> str:
    """读取用户上传文档的指定块。

    Args:
        file_id: 文档 ID（由上传接口返回）
        chunk_index: 块序号，从 0 开始

    Returns:
        文档内容文本，附带块信息说明
    """
    from app.services.document_store import document_store

    result = document_store.read_chunk(file_id, chunk_index)
    if result is None:
        meta = document_store.get_meta(file_id)
        if meta is None:
            return f"[错误] 文档 {file_id} 不存在或已过期（上传后 2 小时内有效）"
        total = meta["total_chunks"]
        return (
            f"[错误] chunk_index={chunk_index} 超出范围，"
            f"该文档共 {total} 块（0 ~ {total - 1}）"
        )

    chunk_text, total_chunks = result
    header = (
        f"[文档块 {chunk_index + 1}/{total_chunks}]"
        + (f"（共 {total_chunks} 块，如需继续请调用 read_document(file_id='{file_id}', chunk_index={chunk_index + 1})）"
           if chunk_index + 1 < total_chunks else "（已是最后一块）")
        + "\n\n"
    )
    return header + chunk_text


tool_registry.register(
    ToolDefinition(
        name="read_document",
        description=(
            "读取用户上传的文档内容。文档已被分块，每次返回一块（约 1500 字）。"
            "参数 chunk_index 从 0 开始，返回内容会告知总块数，如需读取后续内容请递增 chunk_index 继续调用。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "string",
                    "description": "文档 ID，由用户上传文档后系统提供",
                },
                "chunk_index": {
                    "type": "integer",
                    "description": "块序号，从 0 开始，默认读取第 0 块",
                },
            },
            "required": ["file_id"],
        },
        handler=_read_document_handler,
    )
)

logger.info("tool registered: read_document")
