package com.example.aidebugger.model

data class BreakpointSnapshot(
    val file: String,
    val className: String,
    val method: String,
    val line: Int,
    val callStack: List<StackFrame>,
    val variables: List<Variable>,
    val timestamp: Long
)

data class StackFrame(
    val className: String,
    val method: String,
    val line: Int,
    val file: String,
    /** 该帧的局部变量（系统帧为空列表） */
    val variables: List<Variable> = emptyList()
)

data class Variable(
    val name: String,
    val value: String,
    val type: String,
    val children: List<Variable> = emptyList()
)

/**
 * AI 分析结果（由后端 Agent 返回，通过 RecommendPoller 或其他渠道传入面板）。
 * Lobi 相关字段已移除，仅保留核心分析内容。
 */
data class AnalysisResponse(
    val conclusion: String = "",
    val suggestion: String = "",
    val error: String? = null
)
