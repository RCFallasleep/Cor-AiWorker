package com.example.aidebugger.network

/**
 * 全局单例，管理 [RecommendPoller] 的生命周期。
 *
 * - 插件启动时由 [com.example.aidebugger.AiDebuggerStartupActivity] 调用 [start]
 * - Settings 页通过 [isRunning] 查询当前状态
 */
object RecommendPollerManager {

    private var poller: RecommendPoller? = null

    val isRunning: Boolean get() = poller?.isRunning == true

    fun start() {
        if (poller?.isRunning == true) return
        poller = RecommendPoller().also { it.start() }
    }

    fun stop() {
        poller?.stop()
        poller = null
    }

    fun restart() {
        stop()
        start()
    }

    fun addListener(listener: RecommendPoller.RecommendationListener) {
        poller?.addListener(listener)
    }

    fun removeListener(listener: RecommendPoller.RecommendationListener) {
        poller?.removeListener(listener)
    }
}
