package com.example.aidebugger.ui

import com.example.aidebugger.network.RecommendPoller
import com.example.aidebugger.network.RecommendPollerManager
import com.example.aidebugger.settings.AiDebuggerSettings
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.*
import java.text.SimpleDateFormat
import java.util.Date
import javax.swing.*

/**
 * Agent 断点推荐面板（Tab 2）。
 *
 * 展示：
 *  - 后端连接状态 + 轮询器状态
 *  - Agent 推荐的断点历史（每次收到推荐时自动追加）
 *
 * 新版零配置：断点命中自动推送，Agent 推荐自动打断点，无需手动操作。
 */
class AiAnalysisPanel(private val project: Project) : JBPanel<AiAnalysisPanel>(BorderLayout()) {

    private val recommendHistory = mutableListOf<RecommendEntry>()
    private val sdf = SimpleDateFormat("HH:mm:ss")

    // ── 推荐历史列表 ──────────────────────────────────────────────────────────
    private val historyPanel = JBPanel<JBPanel<*>>().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        background = JBColor.background()
    }
    private val historyScroll = JBScrollPane(historyPanel).apply {
        border = BorderFactory.createEmptyBorder()
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    // ── 状态栏 ────────────────────────────────────────────────────────────────
    private val statusLabel = JBLabel("").apply {
        font = font.deriveFont(11f)
        border = JBUI.Borders.empty(4, 8)
    }

    init {
        background = JBColor.background()
        add(buildToolbar(), BorderLayout.NORTH)
        add(buildStatusBar(), BorderLayout.CENTER.also { _ ->
            // 实际布局：状态条在上，历史列表在下
        })

        val centerPanel = JPanel(BorderLayout()).apply {
            isOpaque = false
            add(buildStatusBar(), BorderLayout.NORTH)
            add(historyScroll, BorderLayout.CENTER)
        }
        add(centerPanel, BorderLayout.CENTER)

        // 注册推荐监听器，收到推荐时追加到历史
        RecommendPollerManager.addListener(object : RecommendPoller.RecommendationListener {
            override fun onRecommendations(recommendations: List<RecommendPoller.BreakpointRecommendation>) {
                SwingUtilities.invokeLater {
                    val time = sdf.format(Date())
                    recommendations.forEach { rec ->
                        recommendHistory.add(RecommendEntry(time, rec))
                    }
                    rebuildHistory()
                }
            }
        })

        rebuildHistory()
    }

    // ── 工具栏 ────────────────────────────────────────────────────────────────

    private fun buildToolbar(): JPanel {
        return JPanel(BorderLayout()).apply {
            border = BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor(0xDDDDDD, 0x3D3F41))
            background = JBColor.background()
            preferredSize = Dimension(0, 36)

            val title = JBLabel("  🤖 Agent 断点推荐").apply {
                font = font.deriveFont(Font.BOLD, 12f)
            }
            val clearBtn = JButton("清空").apply {
                font = font.deriveFont(10f)
                isFocusPainted = false
                border = JBUI.Borders.empty(3, 8)
                cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
                addActionListener {
                    recommendHistory.clear()
                    rebuildHistory()
                }
            }
            add(title, BorderLayout.WEST)
            add(clearBtn, BorderLayout.EAST)
        }
    }

    private fun buildStatusBar(): JPanel {
        val backendUrl = AiDebuggerSettings.getInstance().backendUrl
        val pollerRunning = RecommendPollerManager.isRunning

        val statusText = if (pollerRunning) {
            "● 轮询中  ·  后端：$backendUrl"
        } else {
            "○ 轮询未启动  ·  后端：$backendUrl"
        }
        statusLabel.text = statusText
        statusLabel.foreground = if (pollerRunning) JBColor(0x006600, 0x4CAF50) else JBColor.GRAY

        return JPanel(BorderLayout()).apply {
            isOpaque = true
            background = JBColor(0xEEEEEE, 0x2B2D30)
            border = BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor(0xDDDDDD, 0x3D3F41))
            add(statusLabel, BorderLayout.WEST)
        }
    }

    // ── 推荐历史 ──────────────────────────────────────────────────────────────

    private fun rebuildHistory() {
        historyPanel.removeAll()

        if (recommendHistory.isEmpty()) {
            historyPanel.add(buildHintRow("暂无断点推荐"))
            historyPanel.add(buildHintRow("Agent 调用 set_breakpoint 工具后，推荐将自动出现在此处并打断点"))
        } else {
            // 倒序展示（最新的在最上面）
            recommendHistory.asReversed().forEach { entry ->
                historyPanel.add(buildRecommendRow(entry))
            }
        }

        historyPanel.add(Box.createVerticalGlue())
        historyPanel.revalidate()
        historyPanel.repaint()
    }

    private fun buildRecommendRow(entry: RecommendEntry): JPanel {
        val rec = entry.recommendation
        return JPanel(BorderLayout()).apply {
            isOpaque = true
            background = JBColor.background()
            border = JBUI.Borders.empty(6, 12, 6, 8)
            maximumSize = Dimension(Int.MAX_VALUE, 70)

            val textPanel = JPanel().apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                isOpaque = false

                add(JBLabel("📍  ${rec.file}  ·  第 ${rec.line} 行").apply {
                    font = font.deriveFont(Font.BOLD, 11f)
                })
                add(JBLabel("原因：${rec.reason.ifBlank { "（未说明）" }}").apply {
                    font = font.deriveFont(10f)
                    foreground = JBColor.GRAY
                })
                add(JBLabel("时间：${entry.time}  ·  已自动打断点 ✅").apply {
                    font = font.deriveFont(9f)
                    foreground = JBColor(0x006600, 0x4CAF50)
                })
            }
            add(textPanel, BorderLayout.CENTER)

            // 底部分隔线
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor(0xEEEEEE, 0x3D3F41)),
                JBUI.Borders.empty(6, 12, 6, 8)
            )
        }
    }

    private fun buildHintRow(text: String): JPanel {
        return JPanel(FlowLayout(FlowLayout.LEFT, 16, 8)).apply {
            isOpaque = false
            maximumSize = Dimension(Int.MAX_VALUE, 36)
            add(JBLabel(text).apply { foreground = JBColor.GRAY; font = font.deriveFont(11f) })
        }
    }

    // ── 数据模型 ──────────────────────────────────────────────────────────────

    private data class RecommendEntry(
        val time: String,
        val recommendation: RecommendPoller.BreakpointRecommendation
    )
}
