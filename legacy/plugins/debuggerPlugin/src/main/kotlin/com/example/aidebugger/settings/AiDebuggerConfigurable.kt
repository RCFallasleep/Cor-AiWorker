package com.example.aidebugger.settings

import com.example.aidebugger.network.RecommendPollerManager
import com.intellij.openapi.options.Configurable
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import javax.swing.*

class AiDebuggerConfigurable : Configurable {

    private var panel: JPanel? = null

    // ── 后端地址配置 ───────────────────────────────────────────────────────
    private val backendUrlField = JBTextField().apply {
        columns = 30
        toolTipText = "Cor-AiWorker 后端地址，默认 http://localhost:8000"
        emptyText.text = "http://localhost:8000"
    }
    private val testBtn = JButton("测试连通性").apply { isFocusPainted = false }
    private val testStatusLabel = JBLabel("").apply { font = font.deriveFont(11f) }
    private val pollerStatusLabel = JBLabel("").apply { font = font.deriveFont(11f) }

    // ── 变量采集参数 ────────────────────────────────────────────────────────
    private val depthSpinner = JSpinner(SpinnerNumberModel(3, 1, 5, 1))
    private val collectionSizeSpinner = JSpinner(SpinnerNumberModel(10, 1, 100, 1))

    override fun getDisplayName(): String = "AI Debugger"

    override fun createComponent(): JComponent {
        val urlRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(backendUrlField)
            add(Box.createHorizontalStrut(8))
            add(testBtn)
            add(Box.createHorizontalStrut(8))
            add(testStatusLabel)
        }
        val urlHint = JBLabel(
            "<html><font color='gray' size='2'>" +
            "Cor-AiWorker 后端地址。Docker 启动后默认 http://localhost:8000 即可，无需修改。<br>" +
            "点击「测试连通性」验证后端是否可达。</font></html>"
        ).apply { border = JBUI.Borders.emptyTop(4) }

        val pollerRow = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            isOpaque = false
            add(pollerStatusLabel)
        }

        panel = FormBuilder.createFormBuilder()
            .addLabeledComponent(JBLabel("后端地址："), urlRow, 1, false)
            .addComponent(urlHint)
            .addSeparator(12)
            .addLabeledComponent(JBLabel("断点推荐轮询："), pollerRow, 1, false)
            .addSeparator(12)
            .addLabeledComponent(JBLabel("变量递归深度 (1-5)："), depthSpinner, 1, false)
            .addLabeledComponent(JBLabel("集合最大元素数："), collectionSizeSpinner, 1, false)
            .addComponentFillVertically(JPanel(), 0)
            .panel
            .also { it.border = JBUI.Borders.empty(8) }

        testBtn.addActionListener { runConnectivityTest() }
        updatePollerStatus()

        return panel!!
    }

    // ── 连通性测试 ─────────────────────────────────────────────────────────

    private fun runConnectivityTest() {
        val url = backendUrlField.text.trim().trimEnd('/')
        if (url.isBlank()) {
            testStatusLabel.text = "⚠️ 请先输入后端地址"
            testStatusLabel.foreground = JBColor(0xCC6600, 0xFF9900)
            return
        }
        testBtn.isEnabled = false
        testStatusLabel.text = "⏳ 测试中…"
        testStatusLabel.foreground = JBColor(0x888888, 0x999999)

        Thread {
            val (code, msg) = try {
                val conn = URL("$url/v1/debug/snapshot/latest").openConnection() as HttpURLConnection
                conn.requestMethod = "GET"
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                val c = conn.responseCode
                conn.disconnect()
                c to null
            } catch (e: java.net.ConnectException)       { -1 to "无法连接：${e.message}" }
              catch (e: java.net.SocketTimeoutException) { -2 to "连接超时（5s）" }
              catch (e: Exception)                       { -3 to (e.message ?: "未知错误") }

            SwingUtilities.invokeLater {
                testBtn.isEnabled = true
                when {
                    code in 200..299 -> {
                        testStatusLabel.text = "✅ 后端可达（HTTP $code）"
                        testStatusLabel.foreground = JBColor(0x006600, 0x00CC00)
                    }
                    code > 0 -> {
                        testStatusLabel.text = "⚠️ 后端响应 HTTP $code"
                        testStatusLabel.foreground = JBColor(0xCC6600, 0xFF9900)
                    }
                    else -> {
                        testStatusLabel.text = "❌ $msg"
                        testStatusLabel.foreground = JBColor(0xCC0000, 0xFF4444)
                    }
                }
            }
        }.also { it.isDaemon = true }.start()
    }

    private fun updatePollerStatus() {
        val running = RecommendPollerManager.isRunning
        pollerStatusLabel.text = if (running) "● 运行中（轮询后端断点推荐）" else "○ 未启动"
        pollerStatusLabel.foreground = if (running) JBColor(0x006600, 0x00CC00) else JBColor.GRAY
    }

    // ── Configurable 接口 ──────────────────────────────────────────────────

    override fun isModified(): Boolean {
        val s = AiDebuggerSettings.getInstance()
        return backendUrlField.text.trim().trimEnd('/') != s.backendUrl ||
               (depthSpinner.value as Int) != s.variableDepth ||
               (collectionSizeSpinner.value as Int) != s.collectionMaxSize
    }

    override fun apply() {
        val s = AiDebuggerSettings.getInstance()
        s.backendUrl        = backendUrlField.text.trim()
        s.variableDepth     = depthSpinner.value as Int
        s.collectionMaxSize = collectionSizeSpinner.value as Int
        testStatusLabel.text = ""
        updatePollerStatus()
    }

    override fun reset() {
        val s = AiDebuggerSettings.getInstance()
        backendUrlField.text        = s.backendUrl
        depthSpinner.value          = s.variableDepth
        collectionSizeSpinner.value = s.collectionMaxSize
        testStatusLabel.text        = ""
        updatePollerStatus()
    }

    override fun disposeUIResources() { panel = null }
}
