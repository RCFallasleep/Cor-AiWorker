package com.example.aidebugger.network

import com.example.aidebugger.settings.AiDebuggerSettings
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 断点推荐轮询器。
 *
 * 替代原来的 LobiCallbackServer（被动监听 18766 端口）。
 * 改为主动长轮询 GET {backendUrl}/v1/debug/recommend/poll，
 * 后端有推荐时立即返回，无推荐时最多等待 20 秒再重试。
 *
 * 优点：
 *  - 零配置：不需要开放本地端口，不需要注册 IP
 *  - 穿透 Docker：插件在宿主机，后端在容器，轮询方向是插件→后端，天然可达
 *  - 无防火墙问题：只有出站请求，无入站监听
 */
class RecommendPoller {

    interface RecommendationListener {
        /** 在后台线程调用，不可直接操作 UI */
        fun onRecommendations(recommendations: List<BreakpointRecommendation>)
    }

    data class BreakpointRecommendation(
        val file: String,
        val line: Int,
        val reason: String
    )

    private val running = AtomicBoolean(false)
    private val listeners = mutableListOf<RecommendationListener>()
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "cor-recommend-poller").also { it.isDaemon = true }
    }

    fun addListener(listener: RecommendationListener) { listeners.add(listener) }
    fun removeListener(listener: RecommendationListener) { listeners.remove(listener) }

    val isRunning: Boolean get() = running.get()

    // ── 启动 / 停止 ────────────────────────────────────────────────────────────

    fun start() {
        if (running.getAndSet(true)) return
        executor.submit { pollLoop() }
        println("[AIDebugger] RecommendPoller 已启动，轮询后端断点推荐")
    }

    fun stop() {
        running.set(false)
        println("[AIDebugger] RecommendPoller 已停止")
    }

    // ── 轮询主循环 ─────────────────────────────────────────────────────────────

    private fun pollLoop() {
        while (running.get()) {
            try {
                val backendUrl = AiDebuggerSettings.getInstance().backendUrl
                val url = "$backendUrl/v1/debug/recommend/poll?timeout=20"
                val result = getJson(url, timeoutMs = 25_000)  // 比服务端等待时间多 5s
                if (result != null) {
                    val recs = parseRecommendations(result)
                    if (recs.isNotEmpty()) {
                        println("[AIDebugger] 收到断点推荐 ${recs.size} 条")
                        listeners.forEach { it.onRecommendations(recs) }
                    }
                }
            } catch (e: java.net.SocketTimeoutException) {
                // 正常超时（服务端 20s 无推荐），立即重试
            } catch (e: java.net.ConnectException) {
                // 后端未启动，等 3 秒再重试
                println("[AIDebugger] 无法连接后端，3 秒后重试：${e.message}")
                Thread.sleep(3000)
            } catch (e: InterruptedException) {
                break
            } catch (e: Exception) {
                if (running.get()) {
                    println("[AIDebugger] 轮询异常：${e.message}")
                    Thread.sleep(2000)
                }
            }
        }
    }

    // ── HTTP GET ──────────────────────────────────────────────────────────────

    private fun getJson(url: String, timeoutMs: Int): String? {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.setRequestProperty("Accept", "application/json")
        conn.connectTimeout = 5000
        conn.readTimeout = timeoutMs
        return try {
            val code = conn.responseCode
            if (code in 200..299) {
                BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
            } else null
        } finally {
            conn.disconnect()
        }
    }

    // ── JSON 解析（无第三方库）────────────────────────────────────────────────

    private fun parseRecommendations(json: String): List<BreakpointRecommendation> {
        // 解析 {"has_recommend": true, "recommendations": [...]}
        val hasRecommend = json.contains("\"has_recommend\":true") ||
                           json.contains("\"has_recommend\": true")
        if (!hasRecommend) return emptyList()

        val result = mutableListOf<BreakpointRecommendation>()
        val keyIdx = json.indexOf(""""recommendations"""").takeIf { it >= 0 } ?: return result
        val bracketStart = json.indexOf('[', keyIdx).takeIf { it >= 0 } ?: return result

        var depth = 0
        val arrayContent = StringBuilder()
        for (i in bracketStart until json.length) {
            when (json[i]) {
                '[' -> { depth++; if (depth == 1) continue }
                ']' -> { depth--; if (depth == 0) break }
            }
            if (depth >= 1) arrayContent.append(json[i])
        }

        var objDepth = 0
        val objBuf = StringBuilder()
        for (ch in arrayContent) {
            when (ch) {
                '{' -> { objDepth++; objBuf.append(ch) }
                '}' -> {
                    objBuf.append(ch); objDepth--
                    if (objDepth == 0) {
                        val obj = objBuf.toString()
                        result.add(BreakpointRecommendation(
                            file   = extractString(obj, "file")   ?: "unknown",
                            line   = extractInt(obj, "line")      ?: -1,
                            reason = extractString(obj, "reason") ?: ""
                        ))
                        objBuf.clear()
                    }
                }
                else -> if (objDepth > 0) objBuf.append(ch)
            }
        }
        return result
    }

    private fun extractString(json: String, key: String): String? =
        Regex(""""$key"\s*:\s*"((?:[^"\\]|\\.)*)"""").find(json)
            ?.groupValues?.get(1)
            ?.replace("\\\"", "\"")
            ?.replace("\\n", "\n")

    private fun extractInt(json: String, key: String): Int? =
        Regex(""""$key"\s*:\s*(\d+)""").find(json)?.groupValues?.get(1)?.toIntOrNull()
}
