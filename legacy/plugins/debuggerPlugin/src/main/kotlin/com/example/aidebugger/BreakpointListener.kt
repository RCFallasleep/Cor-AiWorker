package com.example.aidebugger

import com.example.aidebugger.collector.VariableCollector
import com.example.aidebugger.history.SessionManager
import com.example.aidebugger.model.BreakpointSnapshot
import com.example.aidebugger.model.StackFrame
import com.example.aidebugger.network.CorBackendClient
import com.example.aidebugger.ui.AiDebuggerPanel
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.xdebugger.XDebugProcess
import com.intellij.xdebugger.XDebugSession
import com.intellij.xdebugger.XDebugSessionListener
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.XDebuggerManagerListener
import com.intellij.xdebugger.breakpoints.XLineBreakpoint
import com.intellij.xdebugger.frame.XExecutionStack
import com.intellij.xdebugger.frame.XStackFrame
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class BreakpointListener(private val project: Project) : XDebuggerManagerListener {

    /** 用于串行处理 handleBreakpoint 任务 */
    private val executor = Executors.newSingleThreadExecutor()

    /** 用于并行采集各帧局部变量（CachedThreadPool 防止 ForkJoinPool 阻塞） */
    private val varExecutor = Executors.newCachedThreadPool()

    /**
     * 系统帧包名前缀：匹配时跳过变量采集，只记录位置信息。
     * - java/javax/sun：JDK 标准库
     * - dalvik/libcore：Android 虚拟机内部
     * - android/com.android：Android SDK 框架层
     * - kotlin/kotlinx：Kotlin 标准库与协程库
     */
    private val systemPackages = listOf(
        "java.", "javax.", "sun.", "com.sun.", "com.oracle.",
        "dalvik.", "libcore.",
        "android.", "com.android.",
        "kotlin.", "kotlinx."
    )

    override fun processStarted(debugProcess: XDebugProcess) {
        val session = debugProcess.session
        SessionManager.getInstance(project).onDebugSessionStarted()

        session.addSessionListener(object : XDebugSessionListener {
            override fun sessionPaused() {
                val frame = session.currentStackFrame ?: return
                if (!isAtUserBreakpoint(frame)) return

                executor.submit {
                    try { handleBreakpoint(session, frame) } catch (_: Exception) {}
                }
            }

            override fun sessionStopped() {
                SessionManager.getInstance(project).onDebugSessionStopped()
            }
        })
    }

    // ── 用户断点判断 ─────────────────────────────────────────────────────────

    private fun isAtUserBreakpoint(frame: XStackFrame): Boolean {
        val sourcePosition = frame.sourcePosition ?: return false
        return try {
            val bpManager = XDebuggerManager.getInstance(project).breakpointManager
            bpManager.allBreakpoints.any { bp ->
                bp is XLineBreakpoint<*>
                        && bp.fileUrl == sourcePosition.file.url
                        && bp.line == sourcePosition.line
            }
        } catch (_: Exception) { true }
    }

    // ── 断点命中处理 ─────────────────────────────────────────────────────────

    private fun handleBreakpoint(session: XDebugSession, frame: XStackFrame) {
        val sessionManager = SessionManager.getInstance(project)
        val sourcePosition = frame.sourcePosition
        val fileName = sourcePosition?.file?.name ?: "unknown"
        val lineNumber = (sourcePosition?.line ?: -1) + 1
        val (className, methodName) = extractClassAndMethod(frame)

        // 采集完整调用栈，每个用户帧含各自的局部变量
        val callStack = collectCallStackWithVariables(session)

        // BreakpointSnapshot.variables 与 callStack[0].variables 保持一致（向后兼容）
        val currentVars = callStack.firstOrNull()?.variables ?: emptyList()

        val snapshot = BreakpointSnapshot(
            file = fileName,
            className = className,
            method = methodName,
            line = lineNumber,
            callStack = callStack,
            variables = currentVars,
            timestamp = System.currentTimeMillis()
        )

        val entry = sessionManager.addEntry(snapshot)
        val currentSession = sessionManager.currentSession ?: return

        // 自动推送快照到后端（fire-and-forget，不阻塞 AS 调试流程）
        CorBackendClient.pushSnapshot(currentSession, entry)

        ApplicationManager.getApplication().invokeLater {
            getToolWindow()?.show()
            getPanel()?.renderBreakpointDetail(currentSession, entry)
        }
    }

    // ── 多帧变量采集（核心）─────────────────────────────────────────────────

    /**
     * 分三阶段采集完整调用栈（最多 10 帧）：
     *
     *  Phase 1（4s 超时）：computeStackFrames 仅收集 XStackFrame 引用，
     *                      回调内不做任何耗时操作（规避 ADB 慢速 + 反射卡顿）。
     *  Phase 2          ：在 varExecutor 线程池中，并行完成位置提取 + 变量采集；
     *                      用户帧采集变量，系统帧只提取位置。
     *  Phase 3（8s 超时）：allOf 等待；未完成帧退化为只有位置信息（变量空列表）。
     *
     * 系统帧判断依据：className 匹配 [systemPackages] 前缀，或 file == "unknown"。
     */
    private fun collectCallStackWithVariables(session: XDebugSession): List<StackFrame> {
        val suspendContext = session.suspendContext ?: return emptyList()
        return try {
            val mainStack = suspendContext.executionStacks.toList().firstOrNull()
                ?: return emptyList()

            // ── Phase 1：仅收集 XStackFrame 引用，回调尽量轻量 ──────────────
            //   关键：不在 addStackFrames 内做反射/耗时操作，防止回调阻塞超时。
            val phase1Future = CompletableFuture<List<XStackFrame>>()
            val rawXFrames = mutableListOf<XStackFrame>()

            mainStack.computeStackFrames(0, object : XExecutionStack.XStackFrameContainer {
                private var done = false
                override fun addStackFrames(
                    stackFrames: MutableList<out XStackFrame>,
                    last: Boolean
                ) {
                    for (xFrame in stackFrames) {
                        if (rawXFrames.size >= 10) break
                        rawXFrames.add(xFrame)        // 只存引用，不做任何其他操作
                    }
                    if (last || rawXFrames.size >= 10) {
                        if (!done) { done = true; phase1Future.complete(rawXFrames.toList()) }
                    }
                }

                override fun errorOccurred(errorMessage: String) {
                    if (!phase1Future.isDone) phase1Future.complete(rawXFrames.toList())
                }
            })

            // Phase 1 超时延长到 4s（Android 真机 ADB 通信可能较慢）
            val xFrames = try {
                phase1Future.get(4, TimeUnit.SECONDS)
            } catch (_: Exception) {
                rawXFrames.toList()   // 超时时使用已收到的帧
            }

            if (xFrames.isEmpty()) return emptyList()

            // ── Phase 2：位置提取 + 变量采集全部放到 varExecutor 并行执行 ────
            //   每个帧独立一个 Future：先提取位置信息，再决定是否采集变量。
            val frameFutures = xFrames.map { xFrame ->
                CompletableFuture.supplyAsync({
                    val pos = xFrame.sourcePosition
                    val (cn, mn) = extractClassAndMethod(xFrame)
                    val partial = StackFrame(
                        className = cn,
                        method = mn,
                        line = (pos?.line ?: -1) + 1,
                        file = pos?.file?.name ?: "unknown"
                    )
                    val vars = if (isUserFrame(partial)) {
                        runCatching { VariableCollector.collectVariables(xFrame) }
                            .getOrDefault(emptyList())
                    } else {
                        emptyList()   // 系统帧跳过变量采集
                    }
                    partial.copy(variables = vars)
                }, varExecutor)
            }

            // ── Phase 3：全局 8s 超时，未完成帧只保留已有结果 ────────────────
            try {
                CompletableFuture.allOf(*frameFutures.toTypedArray()).get(8, TimeUnit.SECONDS)
            } catch (_: Exception) { /* 超时：部分帧已完成，未完成帧通过 getNow 退化 */ }

            // 未完成的 Future 用 null 兜底，过滤掉
            frameFutures.mapNotNull { f ->
                if (f.isDone && !f.isCompletedExceptionally) f.getNow(null) else null
            }

        } catch (_: Exception) { emptyList() }
    }

    /** 判断是否为用户代码帧（需要采集变量）：file 可知 且 className 不在系统包前缀列表中 */
    private fun isUserFrame(frame: StackFrame): Boolean {
        if (frame.file == "unknown" || frame.file.isBlank()) return false
        return systemPackages.none { frame.className.startsWith(it) }
    }

    // ── 反射获取 className / methodName ─────────────────────────────────────

    private fun extractClassAndMethod(frame: XStackFrame): Pair<String, String> {
        return try {
            val proxyMethod = frame.javaClass.methods
                .find { it.name == "getStackFrameProxy" || it.name == "stackFrameProxy" }
            val proxy = proxyMethod?.invoke(frame)
            if (proxy != null) {
                val location = proxy.javaClass.methods
                    .find { it.name == "location" }?.invoke(proxy)
                if (location != null) {
                    val declaringType = location.javaClass.methods
                        .find { it.name == "declaringType" }?.invoke(location)
                    val method = location.javaClass.methods
                        .find { it.name == "method" }?.invoke(location)
                    val className = declaringType?.javaClass?.getMethod("name")
                        ?.invoke(declaringType)?.toString()
                        ?: frame.sourcePosition?.file?.nameWithoutExtension ?: "unknown"
                    val methodName = method?.javaClass?.getMethod("name")
                        ?.invoke(method)?.toString() ?: "unknown"
                    return Pair(className, methodName)
                }
            }
            Pair(frame.sourcePosition?.file?.nameWithoutExtension ?: "unknown", "unknown")
        } catch (_: Exception) {
            Pair(frame.sourcePosition?.file?.nameWithoutExtension ?: "unknown", "unknown")
        }
    }

    // ── 面板操作 ─────────────────────────────────────────────────────────────

    private fun getToolWindow() =
        ToolWindowManager.getInstance(project).getToolWindow("AI Debugger")

    private fun getPanel(): AiDebuggerPanel? = try {
        getToolWindow()?.contentManager?.getContent(0)?.component as? AiDebuggerPanel
    } catch (_: Exception) { null }
}
