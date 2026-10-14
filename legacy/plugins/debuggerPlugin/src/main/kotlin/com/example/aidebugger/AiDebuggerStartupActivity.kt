package com.example.aidebugger

import com.example.aidebugger.network.RecommendPoller
import com.example.aidebugger.network.RecommendPollerManager
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.xdebugger.XDebuggerManager
import com.intellij.xdebugger.breakpoints.XBreakpointProperties
import com.intellij.xdebugger.breakpoints.XLineBreakpointType

/**
 * 插件 StartupActivity：项目打开后后台执行。
 *
 * 职责：
 * 1. 启动 [RecommendPollerManager]，开始轮询后端断点推荐
 * 2. 注册 [RecommendPoller.RecommendationListener]：
 *    收到 Agent 推荐的断点位置后，自动在 AS 中打断点
 *
 * 零配置：后端地址默认 http://localhost:8000，Docker 启动即可用。
 */
class AiDebuggerStartupActivity : ProjectActivity {

    override suspend fun execute(project: Project) {
        RecommendPollerManager.start()
        RecommendPollerManager.addListener(BreakpointApplier(project))
        println("[AIDebugger] 插件已启动，开始轮询后端断点推荐")
    }

    // ── 断点应用器 ────────────────────────────────────────────────────────────

    /**
     * 收到 Agent 推荐的断点后，在 AS 中自动打断点。
     *
     * 实现策略：
     *  1. 在项目 VFS 中按文件名搜索目标文件（支持 .kt / .java）
     *  2. 找到后通过 [XDebuggerManager] 添加行断点
     *  3. 若文件未找到，打印警告日志（不抛异常，不影响轮询）
     *
     * 注意：XDebuggerManager 操作必须在 EDT（Event Dispatch Thread）中执行。
     */
    private class BreakpointApplier(private val project: Project) : RecommendPoller.RecommendationListener {

        override fun onRecommendations(recommendations: List<RecommendPoller.BreakpointRecommendation>) {
            ApplicationManager.getApplication().invokeLater {
                recommendations.forEach { rec ->
                    applyBreakpoint(rec)
                }
            }
        }

        private fun applyBreakpoint(rec: RecommendPoller.BreakpointRecommendation) {
            if (rec.line <= 0) {
                println("[AIDebugger] 跳过无效断点推荐（line=${rec.line}）：${rec.file}")
                return
            }

            val vFile = findVirtualFile(rec.file)
            if (vFile == null) {
                println("[AIDebugger] 未找到文件，无法打断点：${rec.file}（原因：${rec.reason}）")
                return
            }

            try {
                addLineBreakpoint(vFile, rec.line - 1)  // XDebugger 行号从 0 开始
                println("[AIDebugger] 已打断点：${rec.file}:${rec.line}（${rec.reason}）")
            } catch (e: Exception) {
                println("[AIDebugger] 打断点失败：${rec.file}:${rec.line} → ${e.message}")
            }
        }

        /**
         * 在项目 VFS 中按文件名查找目标文件。
         * 优先精确匹配，支持 .kt / .java 后缀自动补全。
         */
        private fun findVirtualFile(fileName: String): VirtualFile? {
            // 如果是绝对路径，直接查找
            if (fileName.startsWith("/")) {
                return LocalFileSystem.getInstance().findFileByPath(fileName)
            }

            // 在项目根目录下递归搜索
            val projectBase = project.basePath ?: return null
            val baseVFile = LocalFileSystem.getInstance().findFileByPath(projectBase) ?: return null

            // 尝试直接拼接（相对路径）
            val directMatch = LocalFileSystem.getInstance().findFileByPath("$projectBase/$fileName")
            if (directMatch != null && directMatch.exists()) return directMatch

            // 按文件名递归搜索（只匹配文件名部分）
            val targetName = fileName.substringAfterLast('/')
            return searchRecursive(baseVFile, targetName, depth = 0)
        }

        private fun searchRecursive(dir: VirtualFile, targetName: String, depth: Int): VirtualFile? {
            if (depth > 12) return null  // 防止过深递归
            if (!dir.isDirectory) return null

            for (child in dir.children) {
                if (!child.isDirectory && child.name == targetName) return child
                // 跳过 build / .gradle / .idea 等目录，加速搜索
                if (child.isDirectory && child.name !in SKIP_DIRS) {
                    val found = searchRecursive(child, targetName, depth + 1)
                    if (found != null) return found
                }
            }
            return null
        }

        /**
         * 通过 XDebuggerManager 添加行断点。
         * 使用 Kotlin/Java 通用的行断点类型（XLineBreakpointType）。
         */
        @Suppress("UNCHECKED_CAST")
        private fun addLineBreakpoint(file: VirtualFile, line: Int) {
            val bpManager = XDebuggerManager.getInstance(project).breakpointManager

            // 查找适用于该文件的行断点类型（Kotlin/Java 均支持）
            val bpType = com.intellij.xdebugger.breakpoints.XBreakpointType.EXTENSION_POINT_NAME
                .extensionList
                .filterIsInstance<XLineBreakpointType<*>>()
                .firstOrNull { it.canPutAt(file, line, project) }
                ?: run {
                    println("[AIDebugger] 未找到适用的断点类型：${file.name}:${line + 1}")
                    return
                }

            // 检查是否已存在相同断点，避免重复添加
            val existing = bpManager.allBreakpoints.any { bp ->
                bp is com.intellij.xdebugger.breakpoints.XLineBreakpoint<*>
                        && bp.fileUrl == file.url
                        && bp.line == line
            }
            if (existing) {
                println("[AIDebugger] 断点已存在，跳过：${file.name}:${line + 1}")
                return
            }

            ApplicationManager.getApplication().runWriteAction {
                bpManager.addLineBreakpoint(
                    bpType as XLineBreakpointType<XBreakpointProperties<*>>,
                    file.url,
                    line,
                    null
                )
            }
        }

        companion object {
            private val SKIP_DIRS = setOf(
                "build", ".gradle", ".idea", ".git", "node_modules",
                "intermediates", "generated", "tmp", ".cxx"
            )
        }
    }
}
