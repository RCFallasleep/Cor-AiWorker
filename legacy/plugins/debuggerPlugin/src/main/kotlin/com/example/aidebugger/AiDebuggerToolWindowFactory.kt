package com.example.aidebugger

import com.example.aidebugger.ui.AiAnalysisPanel
import com.example.aidebugger.ui.AiDebuggerPanel
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class AiDebuggerToolWindowFactory : ToolWindowFactory {

    override fun shouldBeAvailable(project: Project): Boolean = true

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val contentFactory = ContentFactory.getInstance()

        // Tab 1：调试记录（会话列表 + 断点详情）
        val debugPanel = AiDebuggerPanel(project)
        val debugContent = contentFactory.createContent(debugPanel, "调试记录", false)

        // Tab 2：AI 分析（断点选择 + 发送）
        val analysisPanel = AiAnalysisPanel(project)
        val analysisContent = contentFactory.createContent(analysisPanel, "AI 分析", false)

        toolWindow.contentManager.addContent(debugContent)
        toolWindow.contentManager.addContent(analysisContent)
    }
}
