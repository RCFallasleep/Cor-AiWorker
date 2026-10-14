package com.example.aidebugger.history

import com.example.aidebugger.model.*
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.concurrent.CopyOnWriteArrayList

@Service(Service.Level.PROJECT)
class SessionManager(private val project: Project) {

    // 所有会话，最新的在前
    private val sessions = CopyOnWriteArrayList<DebugSession>()

    // 当前活跃会话（正在调试的）
    @Volatile
    var currentSession: DebugSession? = null
        private set

    val allSessions: List<DebugSession> get() = sessions.toList()
    val pastSessions: List<DebugSession>
        get() = sessions.filter { it.id != currentSession?.id }

    private val storageDir: File by lazy {
        val dir = File(System.getProperty("user.home"), ".ai-debugger/sessions/${sanitize(project.name)}")
        dir.mkdirs()
        dir
    }

    // 监听器：面板订阅数据变化
    private val listeners = CopyOnWriteArrayList<SessionChangeListener>()

    interface SessionChangeListener {
        fun onSessionListChanged()
        fun onEntryChanged(session: DebugSession, entry: SnapshotEntry)
    }

    fun addListener(l: SessionChangeListener) = listeners.add(l)
    fun removeListener(l: SessionChangeListener) = listeners.remove(l)

    init {
        loadFromDisk()
    }

    // ── 会话管理 ──

    /** 新调试进程启动：自动创建新会话，原会话归入历史 */
    fun onDebugSessionStarted(): DebugSession {
        val session = DebugSession(name = generateName())
        sessions.add(0, session)
        currentSession = session
        notifyListChanged()
        return session
    }

    /** 用户手动点击"新会话"按钮 */
    fun createManualSession(name: String = generateName()): DebugSession {
        val session = DebugSession(name = name)
        sessions.add(0, session)
        currentSession = session
        notifyListChanged()
        return session
    }

    /** 调试进程结束：当前会话归入历史 */
    fun onDebugSessionStopped() {
        currentSession = null
        notifyListChanged()
    }

    /** 获取当前会话，不存在则创建 */
    fun getCurrentOrCreate(): DebugSession {
        return currentSession ?: onDebugSessionStarted()
    }

    /** 重命名会话 */
    fun renameSession(sessionId: String, newName: String) {
        sessions.find { it.id == sessionId }?.let {
            it.name = newName
            saveToDisk(it)
            notifyListChanged()
        }
    }

    /** 删除历史会话 */
    fun deleteSession(sessionId: String) {
        sessions.removeIf { it.id == sessionId }
        File(storageDir, "$sessionId.json").delete()
        notifyListChanged()
    }

    // ── 断点 Entry 管理 ──

    fun addEntry(snapshot: BreakpointSnapshot): SnapshotEntry {
        val session = getCurrentOrCreate()
        val entry = session.addEntry(snapshot)
        saveToDisk(session)
        notifyEntryChanged(session, entry)
        return entry
    }

    fun updateEntryResponse(sessionId: String, entryIndex: Int, response: AnalysisResponse) {
        val session = sessions.find { it.id == sessionId } ?: return
        session.updateEntry(entryIndex, response)
        saveToDisk(session)
        val entry = session.getEntry(entryIndex) ?: return
        notifyEntryChanged(session, entry)
    }

    // ── 通知 ──

    private fun notifyListChanged() = listeners.forEach { it.onSessionListChanged() }
    private fun notifyEntryChanged(s: DebugSession, e: SnapshotEntry) =
        listeners.forEach { it.onEntryChanged(s, e) }

    // ── 持久化 ──

    private fun saveToDisk(session: DebugSession) {
        try {
            File(storageDir, "${session.id}.json").writeText(sessionToJson(session))
        } catch (_: Exception) {}
    }

    private fun loadFromDisk() {
        try {
            val files = storageDir.listFiles { f -> f.extension == "json" } ?: return
            val loaded = files.mapNotNull { f ->
                try { parseSession(f.readText()) } catch (_: Exception) { null }
            }.sortedByDescending { it.createdAt }
            sessions.addAll(loaded)
        } catch (_: Exception) {}
    }

    // ── JSON 序列化 ──

    private fun sessionToJson(s: DebugSession): String {
        val sb = StringBuilder()
        sb.append("{\n")
        sb.append("  \"id\": ${js(s.id)},\n")
        sb.append("  \"name\": ${js(s.name)},\n")
        sb.append("  \"createdAt\": ${s.createdAt},\n")
        sb.append("  \"entries\": [\n")
        s.entries.forEachIndexed { i, entry ->
            sb.append("    ${entryToJson(entry)}")
            if (i < s.entries.size - 1) sb.append(",")
            sb.append("\n")
        }
        sb.append("  ]\n}")
        return sb.toString()
    }

    private fun entryToJson(e: SnapshotEntry): String {
        val sb = StringBuilder()
        sb.append("{\"index\":${e.index},\"snapshot\":${snapshotToJson(e.snapshot)}")
        e.response?.let { sb.append(",\"response\":${responseToJson(it)}") }
        sb.append("}")
        return sb.toString()
    }

    private fun snapshotToJson(s: BreakpointSnapshot) =
        "{\"file\":${js(s.file)},\"className\":${js(s.className)},\"method\":${js(s.method)}," +
                "\"line\":${s.line},\"timestamp\":${s.timestamp}," +
                "\"callStack\":[${s.callStack.joinToString(",") { frameToJson(it) }}]," +
                "\"variables\":[${s.variables.joinToString(",") { variableToJson(it) }}]}"

    private fun frameToJson(f: StackFrame) =
        "{\"className\":${js(f.className)},\"method\":${js(f.method)},\"line\":${f.line},\"file\":${js(f.file)}," +
                "\"variables\":[${f.variables.joinToString(",") { variableToJson(it) }}]}"

    private fun variableToJson(v: Variable): String {
        val childrenPart = if (v.children.isEmpty()) "[]"
        else "[${v.children.joinToString(",") { variableToJson(it) }}]"
        return "{\"name\":${js(v.name)},\"value\":${js(v.value)},\"type\":${js(v.type)},\"children\":$childrenPart}"
    }

    private fun responseToJson(r: AnalysisResponse): String {
        val errorPart = if (r.error != null) ",\"error\":${js(r.error)}" else ""
        return "{\"conclusion\":${js(r.conclusion)},\"suggestion\":${js(r.suggestion)}$errorPart}"
    }

    private fun js(s: String): String {
        val e = s.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
        return "\"$e\""
    }

    // ── JSON 反序列化 ──

    private fun parseSession(json: String): DebugSession? = try {
        val id = extractStr(json, "id") ?: return null
        val name = extractStr(json, "name") ?: return null
        val createdAt = extractLong(json, "createdAt") ?: 0L
        val entries = parseEntries(extractArray(json, "entries")).toMutableList()
        DebugSession(id = id, name = name, createdAt = createdAt, entries = entries)
    } catch (_: Exception) { null }

    private fun parseEntries(json: String): List<SnapshotEntry> =
        if (json.isBlank() || json == "[]") emptyList()
        else splitObjects(json).mapNotNull { parseEntry(it) }

    private fun parseEntry(json: String): SnapshotEntry? = try {
        val index = extractInt(json, "index") ?: return null
        val snapshotJson = extractObject(json, "snapshot") ?: return null
        val snapshot = parseSnapshot(snapshotJson) ?: return null
        val response = extractObject(json, "response")?.let { parseResponse(it) }
        SnapshotEntry(index = index, snapshot = snapshot, response = response)
    } catch (_: Exception) { null }

    private fun parseSnapshot(json: String): BreakpointSnapshot? = try {
        BreakpointSnapshot(
            file = extractStr(json, "file") ?: "",
            className = extractStr(json, "className") ?: "",
            method = extractStr(json, "method") ?: "",
            line = extractInt(json, "line") ?: 0,
            callStack = parseFrames(extractArray(json, "callStack")),
            variables = parseVariables(extractArray(json, "variables")),
            timestamp = extractLong(json, "timestamp") ?: 0L
        )
    } catch (_: Exception) { null }

    private fun parseFrames(json: String): List<StackFrame> =
        if (json.isBlank() || json == "[]") emptyList()
        else splitObjects(json).mapNotNull { obj ->
            try {
                StackFrame(
                    className = extractStr(obj, "className") ?: "",
                    method = extractStr(obj, "method") ?: "",
                    line = extractInt(obj, "line") ?: 0,
                    file = extractStr(obj, "file") ?: "",
                    variables = parseVariables(extractArray(obj, "variables"))
                )
            } catch (_: Exception) { null }
        }

    private fun parseVariables(json: String): List<Variable> =
        if (json.isBlank() || json == "[]") emptyList()
        else splitObjects(json).mapNotNull { parseVariable(it) }

    private fun parseVariable(json: String): Variable? = try {
        Variable(
            name = extractStr(json, "name") ?: "",
            value = extractStr(json, "value") ?: "",
            type = extractStr(json, "type") ?: "",
            children = parseVariables(extractArray(json, "children"))
        )
    } catch (_: Exception) { null }

    private fun parseResponse(json: String): AnalysisResponse? = try {
        AnalysisResponse(
            conclusion = extractStr(json, "conclusion") ?: "",
            suggestion = extractStr(json, "suggestion") ?: "",
            error = extractStr(json, "error")
        )
    } catch (_: Exception) { null }

    // ── JSON 工具函数 ──

    private fun extractStr(json: String, key: String): String? =
        Regex(""""$key"\s*:\s*"((?:[^"\\]|\\.)*)"""").find(json)?.groupValues?.get(1)
            ?.replace("\\\"", "\"")?.replace("\\n", "\n")
            ?.replace("\\r", "\r")?.replace("\\t", "\t")?.replace("\\\\", "\\")

    private fun extractInt(json: String, key: String): Int? =
        Regex(""""$key"\s*:\s*(-?\d+)""").find(json)?.groupValues?.get(1)?.toIntOrNull()

    private fun extractLong(json: String, key: String): Long? =
        Regex(""""$key"\s*:\s*(-?\d+)""").find(json)?.groupValues?.get(1)?.toLongOrNull()

    private fun extractArray(json: String, key: String): String {
        val start = json.indexOf("\"$key\"").takeIf { it >= 0 } ?: return ""
        val bracketStart = json.indexOf('[', start).takeIf { it >= 0 } ?: return ""
        var depth = 0
        for (i in bracketStart until json.length) {
            when (json[i]) { '[' -> depth++; ']' -> { depth--; if (depth == 0) return json.substring(bracketStart + 1, i) } }
        }
        return ""
    }

    private fun extractObject(json: String, key: String): String? {
        val start = json.indexOf("\"$key\"").takeIf { it >= 0 } ?: return null
        val braceStart = json.indexOf('{', start).takeIf { it >= 0 } ?: return null
        var depth = 0
        for (i in braceStart until json.length) {
            when (json[i]) { '{' -> depth++; '}' -> { depth--; if (depth == 0) return json.substring(braceStart, i + 1) } }
        }
        return null
    }

    private fun splitObjects(json: String): List<String> {
        val result = mutableListOf<String>(); var depth = 0; var start = -1
        for (i in json.indices) {
            when (json[i]) {
                '{' -> { if (depth++ == 0) start = i }
                '}' -> { if (--depth == 0 && start >= 0) { result.add(json.substring(start, i + 1)); start = -1 } }
            }
        }
        return result
    }

    // ── 工具 ──

    private fun generateName(): String = "会话 ${SimpleDateFormat("MM-dd HH:mm").format(Date())}"
    private fun sanitize(s: String): String = s.replace(Regex("[^a-zA-Z0-9_\\-]"), "_")

    companion object {
        @JvmStatic
        fun getInstance(project: Project): SessionManager =
            project.getService(SessionManager::class.java)
    }
}
