package com.example.aidebugger.network

import com.example.aidebugger.model.BreakpointSnapshot
import com.example.aidebugger.model.DebugSession
import com.example.aidebugger.model.SnapshotEntry
import com.example.aidebugger.model.StackFrame
import com.example.aidebugger.model.Variable
import com.example.aidebugger.settings.AiDebuggerSettings
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Cor-AiWorker 后端客户端。
 *
 * 职责：
 *  1. 断点命中时，将快照 POST 到 {backendUrl}/v1/debug/snapshot
 *  2. 不再依赖 Lobi/OpenClaw 云端服务，零配置（默认 localhost:8000）
 */
object CorBackendClient {

    private val executor = Executors.newCachedThreadPool { r ->
        Thread(r, "cor-backend-worker").also { it.isDaemon = true }
    }

    private const val TIMEOUT_MS = 5000

    // ── 推送快照（fire-and-forget）────────────────────────────────────────────

    /**
     * 将断点快照异步推送到后端 /v1/debug/snapshot。
     * 不等待响应，失败静默忽略（不影响 AS 调试流程）。
     */
    fun pushSnapshot(session: DebugSession, entry: SnapshotEntry) {
        val backendUrl = AiDebuggerSettings.getInstance().backendUrl
        executor.submit {
            try {
                val json = buildSnapshotJson(session, entry)
                postJson("$backendUrl/v1/debug/snapshot", json)
                println("[AIDebugger] 快照已推送到后端 #${entry.index} → ${entry.snapshot.file}:${entry.snapshot.line}")
            } catch (e: Exception) {
                println("[AIDebugger] 快照推送失败：${e.message}")
            }
        }
    }

    // ── JSON 构建 ─────────────────────────────────────────────────────────────

    /**
     * 构建推送给后端的快照 JSON。
     * 格式与 debug_bridge.py 的单断点格式兼容：
     * {
     *   "snapshot": { "file": "...", "line": N, "className": "...", "method": "...",
     *                 "callStack": [...], "variables": [...] }
     * }
     */
    private fun buildSnapshotJson(session: DebugSession, entry: SnapshotEntry): String {
        val s = entry.snapshot
        val sb = StringBuilder()
        sb.append("{")
        sb.append("\"session\":${esc(session.name)},")
        sb.append("\"snapshot\":{")
        sb.append("\"file\":${esc(s.file)},")
        sb.append("\"line\":${s.line},")
        sb.append("\"className\":${esc(s.className)},")
        sb.append("\"method\":${esc(s.method)},")
        sb.append("\"timestamp\":${s.timestamp},")
        sb.append("\"callStack\":[${s.callStack.joinToString(",") { frameToJson(it) }}],")
        sb.append("\"variables\":[${s.variables.joinToString(",") { variableToJson(it) }}]")
        sb.append("}")
        sb.append("}")
        return sb.toString()
    }

    private fun frameToJson(f: StackFrame): String =
        "{\"className\":${esc(f.className)},\"method\":${esc(f.method)}," +
        "\"line\":${f.line},\"file\":${esc(f.file)}," +
        "\"variables\":[${f.variables.joinToString(",") { variableToJson(it) }}]}"

    private fun variableToJson(v: Variable): String {
        val sb = StringBuilder()
        sb.append("{")
        sb.append("\"name\":${esc(v.name)},")
        sb.append("\"value\":${esc(v.value)},")
        sb.append("\"type\":${esc(v.type)},")
        sb.append("\"children\":[${v.children.joinToString(",") { variableToJson(it) }}]")
        sb.append("}")
        return sb.toString()
    }

    private fun esc(s: String): String {
        val escaped = s
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
        return "\"$escaped\""
    }

    // ── HTTP 工具 ─────────────────────────────────────────────────────────────

    private fun postJson(url: String, body: String) {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.connectTimeout = TIMEOUT_MS
        conn.readTimeout = TIMEOUT_MS
        conn.doOutput = true
        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use {
            it.write(body); it.flush()
        }
        val code = conn.responseCode
        conn.disconnect()
        if (code !in 200..299) {
            println("[AIDebugger] 后端返回 HTTP $code")
        }
    }
}
