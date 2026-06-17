"""文档上传与解析接口。

支持格式：PDF / DOCX / TXT / MD
解析后按块（chunk）存储到临时目录，供 read_document 工具按需读取。
临时文件 TTL = 2 小时，由后台定时清理。
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from app.services.document_store import document_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/documents", tags=["Documents"])


class UploadResponse(BaseModel):
    file_id: str
    name: str
    size: int          # 原始文件字节数
    total_chunks: int  # 分块数量
    preview: str       # 前 200 字预览


@router.post("/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)) -> UploadResponse:
    """上传文档，解析为文本并分块存储。

    返回 file_id 供前端传给 Agent，Agent 通过 read_document 工具按需读取。
    """
    name = file.filename or "unknown"
    raw = await file.read()
    size = len(raw)

    if size > 20 * 1024 * 1024:  # 20MB 上限
        raise HTTPException(status_code=413, detail="文件过大，最大支持 20MB")

    suffix = Path(name).suffix.lower()
    if suffix not in (".pdf", ".docx", ".doc", ".txt", ".md"):
        raise HTTPException(status_code=415, detail=f"不支持的文件格式：{suffix}")

    try:
        file_id, total_chunks, preview = document_store.ingest(name, suffix, raw)
    except Exception as exc:
        logger.error("document ingest failed | name=%s error=%s", name, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"文档解析失败：{exc}") from exc

    logger.info("document uploaded | file_id=%s name=%s chunks=%d", file_id, name, total_chunks)
    return UploadResponse(
        file_id=file_id,
        name=name,
        size=size,
        total_chunks=total_chunks,
        preview=preview,
    )


@router.delete("/{file_id}")
async def delete_document(file_id: str) -> dict:
    """手动删除临时文档（可选，TTL 到期也会自动清理）。"""
    removed = document_store.remove(file_id)
    if not removed:
        raise HTTPException(status_code=404, detail="文件不存在或已过期")
    return {"ok": True}
