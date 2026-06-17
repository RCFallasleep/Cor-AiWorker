package com.example.aidebugger.model

import java.util.UUID

/**
 * 单次断点快照 + AI 分析结果
 */
data class SnapshotEntry(
    val index: Int,
    val snapshot: BreakpointSnapshot,
    var response: AnalysisResponse? = null
)

/**
 * 调试会话：一组相关联的断点快照（类似 ChatGPT 的一个对话）
 */
data class DebugSession(
    val id: String = UUID.randomUUID().toString(),
    var name: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val entries: MutableList<SnapshotEntry> = mutableListOf()
) {
    /** 添加断点快照，返回新 Entry */
    @Synchronized
    fun addEntry(snapshot: BreakpointSnapshot): SnapshotEntry {
        val entry = SnapshotEntry(index = entries.size + 1, snapshot = snapshot)
        entries.add(entry)
        return entry
    }

    /** 更新 AI 分析结果 */
    @Synchronized
    fun updateEntry(index: Int, response: AnalysisResponse) {
        entries.find { it.index == index }?.response = response
    }

    fun getEntry(index: Int): SnapshotEntry? = entries.find { it.index == index }

    /** 构建供 AI 分析的历史上下文摘要 */
    fun buildHistoryContext(): String {
        if (entries.size <= 1) return ""
        val sb = StringBuilder()
        sb.append("调试会话「${name}」共命中 ${entries.size} 个断点，执行顺序：\n")
        entries.forEach { e ->
            sb.append("  [#${e.index}] ${e.snapshot.file} · ${e.snapshot.method}() · 第${e.snapshot.line}行\n")
        }
        return sb.toString()
    }
}
