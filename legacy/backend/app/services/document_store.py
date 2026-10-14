"""文档临时存储与解析服务。

职责：
- 解析 PDF / DOCX / TXT / MD 为纯文本
- 按 CHUNK_SIZE 字符分块存储（内存，无磁盘 IO）
- TTL = 2 小时，过期自动清理
- 提供 read_chunk(file_id, chunk_index) 供 read_document 工具调用
"""
from __future__ import annotations

import io
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# 每块字符数（约 375 tokens，留余量给对话历史）
CHUNK_SIZE = 1500
# 临时文件 TTL（秒）
TTL_SECONDS = 7200  # 2 小时


@dataclass
class DocumentRecord:
    file_id: str
    name: str
    chunks: list[str]          # 分块文本列表
    created_at: float = field(default_factory=time.time)

    @property
    def total_chunks(self) -> int:
        return len(self.chunks)

    @property
    def is_expired(self) -> bool:
        return time.time() - self.created_at > TTL_SECONDS


class DocumentStore:
    """内存文档存储，线程安全（GIL 保护，FastAPI 单进程模式下足够）。"""

    def __init__(self) -> None:
        self._store: dict[str, DocumentRecord] = {}

    # ── 解析入口 ──────────────────────────────────────────────────────────────

    def ingest(self, name: str, suffix: str, raw: bytes) -> tuple[str, int, str]:
        """解析文件，分块存储，返回 (file_id, total_chunks, preview)。"""
        self._evict_expired()

        text = self._parse(suffix, raw)
        if not text.strip():
            raise ValueError("文档内容为空，无法解析")

        chunks = self._split(text)
        file_id = str(uuid.uuid4())
        self._store[file_id] = DocumentRecord(
            file_id=file_id,
            name=name,
            chunks=chunks,
        )
        preview = text[:200].replace("\n", " ").strip()
        return file_id, len(chunks), preview

    # ── 读取 ──────────────────────────────────────────────────────────────────

    def read_chunk(self, file_id: str, chunk_index: int) -> Optional[tuple[str, int]]:
        """读取指定块，返回 (chunk_text, total_chunks)，文件不存在返回 None。"""
        self._evict_expired()
        rec = self._store.get(file_id)
        if rec is None:
            return None
        if chunk_index < 0 or chunk_index >= rec.total_chunks:
            return None
        return rec.chunks[chunk_index], rec.total_chunks

    def get_meta(self, file_id: str) -> Optional[dict]:
        """获取文件元数据（name, total_chunks），不存在返回 None。"""
        rec = self._store.get(file_id)
        if rec is None or rec.is_expired:
            return None
        return {"name": rec.name, "total_chunks": rec.total_chunks}

    def remove(self, file_id: str) -> bool:
        """手动删除，返回是否存在。"""
        return self._store.pop(file_id, None) is not None

    # ── 内部工具 ──────────────────────────────────────────────────────────────

    def _evict_expired(self) -> None:
        expired = [fid for fid, rec in self._store.items() if rec.is_expired]
        for fid in expired:
            del self._store[fid]
            logger.debug("document evicted | file_id=%s", fid)

    @staticmethod
    def _split(text: str) -> list[str]:
        """按 CHUNK_SIZE 字符分块，尽量在段落边界切分。"""
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + CHUNK_SIZE
            if end >= len(text):
                chunks.append(text[start:].strip())
                break
            # 尝试在段落边界（\n\n）切分
            boundary = text.rfind("\n\n", start, end)
            if boundary == -1 or boundary <= start:
                # 退而求其次：在换行处切分
                boundary = text.rfind("\n", start, end)
            if boundary == -1 or boundary <= start:
                boundary = end
            chunks.append(text[start:boundary].strip())
            start = boundary
        return [c for c in chunks if c]

    @staticmethod
    def _parse(suffix: str, raw: bytes) -> str:
        """根据文件类型解析为纯文本。"""
        if suffix in (".txt", ".md"):
            # 尝试 UTF-8，失败则 GBK
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("gbk", errors="replace")

        if suffix == ".pdf":
            return DocumentStore._parse_pdf(raw)

        if suffix in (".docx", ".doc"):
            return DocumentStore._parse_docx(raw)

        return raw.decode("utf-8", errors="replace")

    @staticmethod
    def _parse_pdf(raw: bytes) -> str:
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError as exc:
            raise RuntimeError("pypdf 未安装，请执行 pip install pypdf") from exc

        reader = PdfReader(io.BytesIO(raw))
        pages: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                pages.append(text)
        return "\n\n".join(pages)

    @staticmethod
    def _parse_docx(raw: bytes) -> str:
        try:
            from docx import Document  # type: ignore
        except ImportError as exc:
            raise RuntimeError("python-docx 未安装，请执行 pip install python-docx") from exc

        doc = Document(io.BytesIO(raw))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)


# 全局单例
document_store = DocumentStore()
