package com.example.aidebugger.ui

import com.example.aidebugger.history.SessionManager
import com.example.aidebugger.model.AnalysisResponse
import com.example.aidebugger.model.DebugSession
import com.example.aidebugger.model.SnapshotEntry
import com.example.aidebugger.model.StackFrame
import com.example.aidebugger.model.Variable
import com.example.aidebugger.network.RecommendPollerManager
import com.example.aidebugger.settings.AiDebuggerSettings
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.JBSplitter
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import java.awt.*
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeCellRenderer
import javax.swing.tree.DefaultTreeModel

class AiDebuggerPanel(private val project: Project) : JBPanel<AiDebuggerPanel>(BorderLayout()) {

    private val sessionManager = SessionManager.getInstance(project)

    // ── 左侧：会话列表 ────────────────────────────────────────────────────────
    private val sessionListPanel = JBPanel<JBPanel<*>>().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        background = JBColor.background()
    }
    private val sessionListScroll = JBScrollPane(sessionListPanel).apply {
        border = BorderFactory.createMatteBorder(0, 0, 0, 1, JBColor(0xDDDDDD, 0x3D3F41))
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
        minimumSize = Dimension(180, 0)
        preferredSize = Dimension(200, 0)
    }

    // ── 右侧：断点详情 ────────────────────────────────────────────────────────
    private val detailPanel = JBPanel<JBPanel<*>>().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        border = JBUI.Borders.empty(8)
    }
    private val detailScroll = JBScrollPane(detailPanel).apply {
        border = BorderFactory.createEmptyBorder()
        horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
    }

    private val toolbar = buildToolbar()

    private val splitter = JBSplitter(false, 0.3f).apply {
        firstComponent = sessionListScroll
        secondComponent = detailScroll
        dividerWidth = 1
    }

    private val expandedSessions = mutableSetOf<String>()
    private var selectedEntry: Pair<DebugSession, SnapshotEntry>? = null

    init {
        add(toolbar, BorderLayout.NORTH)
        add(splitter, BorderLayout.CENTER)

        sessionManager.addListener(object : SessionManager.SessionChangeListener {
            override fun onSessionListChanged() {
                SwingUtilities.invokeLater { rebuildSessionList() }
            }
            override fun onEntryChanged(session: DebugSession, entry: SnapshotEntry) {
                SwingUtilities.invokeLater {
                    rebuildSessionList()
                    val sel = selectedEntry
                    if (sel?.first?.id == session.id && sel.second.index == entry.index) {
                        renderDetail(session, entry, analysisResponse = null)
                    }
                }
            }
        })

        rebuildSessionList()
        showWelcomeDetail()
    }

    // ── 工具栏 ────────────────────────────────────────────────────────────────

    private fun buildToolbar(): JPanel {
        val panel = JPanel(BorderLayout()).apply {
            border = BorderFactory.createMatteBorder(0, 0, 1, 0, JBColor(0xDDDDDD, 0x3D3F41))
            background = JBColor.background()
            preferredSize = Dimension(0, 36)
        }
        val newBtn = JButton("＋ 新会话").apply {
            font = font.deriveFont(11f)
            isFocusPainted = false
            border = JBUI.Borders.empty(4, 10)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addActionListener {
                val name = JOptionPane.showInputDialog(
                    this@AiDebuggerPanel,
                    "会话名称（留空自动命名）：",
                    "新建调试会话",
                    JOptionPane.PLAIN_MESSAGE
                )
                if (name != null) sessionManager.createManualSession(name.trim())
            }
        }
        panel.add(JBLabel("  AI Debugger").apply { font = font.deriveFont(Font.BOLD, 12f) }, BorderLayout.WEST)
        panel.add(newBtn, BorderLayout.EAST)
        return panel
    }

    // ── 会话列表 ──────────────────────────────────────────────────────────────

    fun rebuildSessionList() {
        sessionListPanel.removeAll()

        val current = sessionManager.currentSession
        val past = sessionManager.pastSessions

        if (current != null) {
            sessionListPanel.add(buildSectionLabel("● 当前会话", JBColor(0x2E7D32, 0x4CAF50)))
            sessionListPanel.add(buildSessionHeader(current, isCurrentSession = true, expanded = true, expandable = false))
            current.entries.forEach { entry -> sessionListPanel.add(buildEntryRow(current, entry)) }
            if (current.entries.isEmpty()) sessionListPanel.add(buildHintRow("等待断点命中..."))
        } else {
            sessionListPanel.add(buildSectionLabel("● 无活跃调试", JBColor.GRAY))
            sessionListPanel.add(buildHintRow("启动 Debug 后自动创建会话"))
        }

        if (past.isNotEmpty()) {
            sessionListPanel.add(buildSectionLabel("📜 历史会话", JBColor.GRAY))
            past.forEach { session ->
                val expanded = expandedSessions.contains(session.id)
                sessionListPanel.add(buildSessionHeader(session, isCurrentSession = false, expanded = expanded, expandable = true))
                if (expanded) {
                    session.entries.forEach { entry -> sessionListPanel.add(buildEntryRow(session, entry)) }
                    if (session.entries.isEmpty()) sessionListPanel.add(buildHintRow("  （无断点记录）"))
                }
            }
        }

        sessionListPanel.add(Box.createVerticalGlue())
        sessionListPanel.revalidate()
        sessionListPanel.repaint()
    }

    private fun buildSectionLabel(text: String, color: Color): JPanel {
        return JPanel(FlowLayout(FlowLayout.LEFT, 8, 4)).apply {
            isOpaque = true
            background = JBColor(0xEEEEEE, 0x252528)
            maximumSize = Dimension(Int.MAX_VALUE, 24)
            add(JBLabel(text).apply { font = font.deriveFont(Font.BOLD, 10f); foreground = color })
        }
    }

    private fun buildSessionHeader(
        session: DebugSession,
        isCurrentSession: Boolean,
        expanded: Boolean,
        expandable: Boolean
    ): JPanel {
        val arrow = if (expandable) (if (expanded) "▾ " else "▸ ") else "  "
        val badge = if (isCurrentSession) " 🟢" else ""

        val panel = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = JBColor.background()
            border = JBUI.Borders.empty(5, 8)
            maximumSize = Dimension(Int.MAX_VALUE, 46)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }

        val textPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            add(JBLabel("$arrow${session.name}$badge").apply { font = font.deriveFont(Font.BOLD, 11f) })
            add(JBLabel("${session.entries.size} 个断点").apply { font = font.deriveFont(9f); foreground = JBColor.GRAY })
        }
        panel.add(textPanel, BorderLayout.CENTER)

        if (!isCurrentSession) panel.componentPopupMenu = buildSessionContextMenu(session)

        if (expandable) {
            panel.addMouseListener(object : MouseAdapter() {
                override fun mouseClicked(e: MouseEvent) {
                    if (e.button == MouseEvent.BUTTON1) {
                        if (expandedSessions.contains(session.id)) expandedSessions.remove(session.id)
                        else expandedSessions.add(session.id)
                        rebuildSessionList()
                    }
                }
            })
        }

        return panel
    }

    private fun buildEntryRow(session: DebugSession, entry: SnapshotEntry): JPanel {
        val snap = entry.snapshot
        val isSelected = selectedEntry?.first?.id == session.id && selectedEntry?.second?.index == entry.index

        val panel = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = if (isSelected) JBColor(0xDCEEFF, 0x2D5A8E) else JBColor.background()
            border = JBUI.Borders.empty(3, 20, 3, 8)
            maximumSize = Dimension(Int.MAX_VALUE, 44)
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }

        val textPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            add(JBLabel("📍  #${entry.index}  ${snap.file}").apply {
                font = font.deriveFont(10f)
                foreground = if (isSelected) JBColor.WHITE else JBColor.foreground()
            })
            add(JBLabel("${snap.method}()  · L${snap.line}").apply {
                font = font.deriveFont(9f)
                foreground = if (isSelected) JBColor(0xCCEEFF, 0xAACCEE) else JBColor.GRAY
            })
        }
        panel.add(textPanel, BorderLayout.CENTER)

        panel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.button == MouseEvent.BUTTON1) {
                    selectedEntry = Pair(session, entry)
                    rebuildSessionList()
                    renderDetail(session, entry, analysisResponse = null)
                }
            }
        })

        return panel
    }

    private fun buildHintRow(text: String): JPanel {
        return JPanel(FlowLayout(FlowLayout.LEFT, 20, 3)).apply {
            isOpaque = false
            maximumSize = Dimension(Int.MAX_VALUE, 26)
            add(JBLabel(text).apply { font = font.deriveFont(10f); foreground = JBColor.GRAY })
        }
    }

    private fun buildSessionContextMenu(session: DebugSession): JPopupMenu {
        return JPopupMenu().apply {
            add(JMenuItem("重命名").apply {
                addActionListener {
                    val newName = JOptionPane.showInputDialog(this@AiDebuggerPanel, "新会话名称：", session.name)
                    if (!newName.isNullOrBlank()) sessionManager.renameSession(session.id, newName.trim())
                }
            })
            add(JMenuItem("删除会话").apply {
                foreground = JBColor.RED
                addActionListener {
                    val confirm = JOptionPane.showConfirmDialog(
                        this@AiDebuggerPanel,
                        "确认删除会话「${session.name}」？",
                        "删除确认",
                        JOptionPane.YES_NO_OPTION
                    )
                    if (confirm == JOptionPane.YES_OPTION) {
                        sessionManager.deleteSession(session.id)
                        if (selectedEntry?.first?.id == session.id) {
                            selectedEntry = null
                            showWelcomeDetail()
                        }
                    }
                }
            })
        }
    }

    // ── 右侧详情渲染 ──────────────────────────────────────────────────────────

    private fun showWelcomeDetail() {
        detailPanel.removeAll()
        detailPanel.add(createCenteredLabel("← 选择左侧断点查看详情", JBColor.GRAY, 12))
        detailPanel.add(createCenteredLabel("新开调试会话后自动展示", JBColor.GRAY, 11))
        repaintDetail()
    }

    /**
     * 断点命中后由 BreakpointListener 调用，立即展示采集到的数据，并预留 AI 分析占位区。
     */
    fun renderBreakpointDetail(session: DebugSession, entry: SnapshotEntry) {
        selectedEntry = Pair(session, entry)
        rebuildSessionList()
        renderDetail(session, entry, analysisResponse = null)
    }

    /**
     * AI 分析结果返回后由 BreakpointListener 回调，追加到已展示的断点详情中。
     * 如果当前面板展示的正是该条断点，则直接局部刷新 AI 区域；否则忽略。
     */
    fun showAnalysisResult(session: DebugSession, entry: SnapshotEntry, response: AnalysisResponse) {
        val sel = selectedEntry ?: return
        if (sel.first.id == session.id && sel.second.index == entry.index) {
            renderDetail(session, entry, analysisResponse = response)
        }
    }

    private fun renderDetail(
        session: DebugSession,
        entry: SnapshotEntry,
        @Suppress("UNUSED_PARAMETER") analysisResponse: AnalysisResponse? = null
    ) {
        val snap = entry.snapshot
        detailPanel.removeAll()

        // 标题
        detailPanel.add(createSectionHeader("📍 ${session.name}  ›  断点 #${entry.index}"))
        detailPanel.add(createInfoBox("${snap.file} · ${snap.method}() · 第 ${snap.line} 行\n类：${snap.className}"))
        detailPanel.add(createSpacer(8))

        // 调用路径概览（取前 5 帧的方法名，快速看到执行链路）
        if (snap.callStack.isNotEmpty()) {
            detailPanel.add(createSectionHeader("🔗 调用路径"))
            val path = snap.callStack.take(5)
                .map { it.method.ifEmpty { it.className.substringAfterLast('.') } }
                .joinToString(" → ")
            detailPanel.add(createInfoBox(path))
            detailPanel.add(createSpacer(6))
        }

        // 调用栈 + 各帧局部变量（JTree 可交互展开，对齐 AS Debugger 体验）
        if (snap.callStack.isNotEmpty()) {
            val userFrameCount = snap.callStack.count { it.file != "unknown" }
            detailPanel.add(createSectionHeader(
                "📚 调用栈（${snap.callStack.size} 帧 / ${userFrameCount} 个用户帧含变量）"
            ))
            detailPanel.add(createCallStackTree(snap.callStack))
            detailPanel.add(createSpacer(8))
        }

        // 本会话断点序列（多断点时展示）
        if (session.entries.size > 1) {
            detailPanel.add(createSectionHeader("🗂 本会话断点序列"))
            val summary = session.entries.joinToString("\n") { e ->
                val marker = if (e.index == entry.index) "▶ " else "  "
                "${marker}#${e.index} ${e.snapshot.file}·${e.snapshot.method}()·L${e.snapshot.line}"
            }
            detailPanel.add(createCodeBox(summary))
            detailPanel.add(createSpacer(8))
        }

        // ── 后端状态 ─────────────────────────────────────────────────────────
        detailPanel.add(createSectionHeader("🤖 Cor-AiWorker"))
        detailPanel.add(createBackendStatusPanel())

        repaintDetail()
    }

    // ── 辅助 UI ──────────────────────────────────────────────────────────────

    /**
     * 显示后端连接状态和轮询器状态。
     * 断点命中时快照已自动推送，无需用户手动操作。
     */
    private fun createBackendStatusPanel(): JPanel {
        val backendUrl = AiDebuggerSettings.getInstance().backendUrl
        val pollerRunning = RecommendPollerManager.isRunning

        val statusText = buildString {
            append("后端地址：$backendUrl\n")
            append("快照推送：断点命中时自动推送 ✅\n")
            append("断点推荐轮询：${if (pollerRunning) "运行中 ✅" else "未启动 ⚠️"}")
        }

        return createInfoBox(statusText, JBColor(0x006600, 0x66BB66))
    }

    private fun createSectionHeader(title: String): JPanel {
        return JPanel(FlowLayout(FlowLayout.LEFT, 0, 4)).apply {
            isOpaque = false
            maximumSize = Dimension(Int.MAX_VALUE, 28)
            add(JBLabel(title).apply { font = font.deriveFont(Font.BOLD, 12f) })
        }
    }

    private fun createInfoBox(text: String, foreground: Color? = null): JPanel {
        val area = JBTextArea(text).apply {
            isEditable = false; lineWrap = true; wrapStyleWord = true
            isOpaque = true
            background = JBColor(0xF5F5F5, 0x2B2D30)
            border = JBUI.Borders.empty(6, 8)
            font = Font(Font.SANS_SERIF, Font.PLAIN, 12)
            this@apply.foreground = foreground ?: JBColor.foreground()
        }
        return JPanel(BorderLayout()).apply {
            isOpaque = false
            add(area, BorderLayout.CENTER)
            maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
        }
    }

    private fun createCodeBox(text: String): JPanel {
        val area = JBTextArea(text).apply {
            isEditable = false; lineWrap = false
            isOpaque = true
            background = JBColor(0xF0F0F0, 0x1E1F22)
            border = JBUI.Borders.empty(6, 8)
            font = Font(Font.MONOSPACED, Font.PLAIN, 11)
        }
        val scroll = JBScrollPane(area).apply {
            border = BorderFactory.createLineBorder(JBColor(0xDDDDDD, 0x3D3F41), 1)
            horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_NEVER
        }
        return JPanel(BorderLayout()).apply {
            isOpaque = false
            add(scroll, BorderLayout.CENTER)
            maximumSize = Dimension(Int.MAX_VALUE, 200)
        }
    }

    private fun createCenteredLabel(text: String, color: Color, size: Int): JPanel {
        return JPanel(FlowLayout(FlowLayout.CENTER)).apply {
            isOpaque = false
            add(JBLabel(text).apply { foreground = color; font = font.deriveFont(size.toFloat()) })
        }
    }

    private fun createSpacer(h: Int) = JPanel().apply {
        isOpaque = false
        preferredSize = Dimension(0, h); minimumSize = Dimension(0, h); maximumSize = Dimension(Int.MAX_VALUE, h)
    }

    // ── JTree 调用栈 ──────────────────────────────────────────────────────────

    /**
     * 构建可交互的调用栈 + 变量 JTree，对齐 AS Debugger Variables 面板体验：
     *  - 每一帧是一个可展开的父节点（默认展开）
     *  - 帧下的变量是子节点；有 children 的变量可继续展开
     *  - 当前帧（#0）节点标记 ▶，字体加粗
     *  - 系统帧显示为灰色斜体，不可展开
     */
    private fun createCallStackTree(frames: List<StackFrame>): JPanel {
        // 根节点（隐藏）
        val root = DefaultMutableTreeNode("root")

        frames.forEachIndexed { i, frame ->
            val isCurrentFrame = i == 0
            val shortClass = frame.className.substringAfterLast('.')
            val isSystemFrame = frame.file == "unknown" || frame.file.isBlank()

            // 帧节点文本
            val frameLabel = if (isCurrentFrame) "▶ #$i  $shortClass.${frame.method}()  ·  ${frame.file}:${frame.line}"
                             else "  #$i  $shortClass.${frame.method}()  ·  ${frame.file}:${frame.line}"
            val frameNode = DefaultMutableTreeNode(FrameNodeData(frameLabel, isCurrentFrame, isSystemFrame))

            when {
                isSystemFrame -> {
                    // 系统帧：加一个说明子节点（不可再展开）
                    frameNode.add(DefaultMutableTreeNode(VarNodeData("[系统帧 — 跳过变量采集]", isPlaceholder = true)))
                }
                frame.variables.isEmpty() -> {
                    frameNode.add(DefaultMutableTreeNode(VarNodeData("（无局部变量）", isPlaceholder = true)))
                }
                else -> {
                    frame.variables.forEach { v -> frameNode.add(buildVarNode(v)) }
                }
            }
            root.add(frameNode)
        }

        val tree = JTree(DefaultTreeModel(root)).apply {
            isRootVisible = false                       // 隐藏根节点
            showsRootHandles = true
            font = Font(Font.MONOSPACED, Font.PLAIN, 12)
            background = JBColor(0xF0F0F0, 0x1E1F22)
            isOpaque = true
            rowHeight = 20

            // 默认展开所有帧节点（第一层），变量节点默认收起
            for (i in 0 until root.childCount) {
                expandRow(i)
            }

            // 自定义 Renderer：帧节点加粗/灰色，变量节点等宽字体
            cellRenderer = object : DefaultTreeCellRenderer() {
                init {
                    leafIcon = null; openIcon = null; closedIcon = null
                    backgroundNonSelectionColor = JBColor(0xF0F0F0, 0x1E1F22)
                    backgroundSelectionColor = JBColor(0xD8E8FF, 0x2D4F6F)
                    borderSelectionColor = null
                }
                override fun getTreeCellRendererComponent(
                    tree: JTree, value: Any, sel: Boolean,
                    expanded: Boolean, leaf: Boolean, row: Int, hasFocus: Boolean
                ): Component {
                    super.getTreeCellRendererComponent(tree, value, sel, expanded, leaf, row, hasFocus)
                    val node = value as? DefaultMutableTreeNode
                    when (val data = node?.userObject) {
                        is FrameNodeData -> {
                            text = data.label
                            font = if (data.isCurrentFrame)
                                Font(Font.MONOSPACED, Font.BOLD, 12)
                            else
                                Font(Font.MONOSPACED, Font.PLAIN, 12)
                            foreground = if (data.isSystemFrame)
                                JBColor(0x888888, 0x777777)
                            else if (data.isCurrentFrame)
                                JBColor(0x0066CC, 0x5BA0E8)
                            else
                                JBColor.foreground()
                        }
                        is VarNodeData -> {
                            text = data.label
                            font = Font(Font.MONOSPACED, Font.PLAIN, 12)
                            foreground = if (data.isPlaceholder)
                                JBColor(0x888888, 0x777777)
                            else
                                JBColor.foreground()
                        }
                        else -> { /* root */ }
                    }
                    border = JBUI.Borders.empty(1, 2)
                    return this
                }
            }
        }

        val scroll = JBScrollPane(tree).apply {
            border = BorderFactory.createLineBorder(JBColor(0xDDDDDD, 0x3D3F41), 1)
            horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
        }
        return JPanel(BorderLayout()).apply {
            isOpaque = false
            add(scroll, BorderLayout.CENTER)
            // 高度随内容自适应，最大 500px
            val rowCount = tree.rowCount.coerceAtLeast(4)
            val height = (rowCount * 22 + 16).coerceIn(80, 500)
            maximumSize = Dimension(Int.MAX_VALUE, height)
            preferredSize = Dimension(0, height)
        }
    }

    /** 递归构建变量树节点 */
    private fun buildVarNode(variable: Variable): DefaultMutableTreeNode {
        val label = "${variable.name}: ${variable.type} = ${variable.value}"
        val node = DefaultMutableTreeNode(VarNodeData(label))
        variable.children.forEach { child -> node.add(buildVarNode(child)) }
        return node
    }

    /** 帧节点携带的数据 */
    private data class FrameNodeData(
        val label: String,
        val isCurrentFrame: Boolean,
        val isSystemFrame: Boolean
    )

    /** 变量节点携带的数据（isPlaceholder=true 时为提示文本节点） */
    private data class VarNodeData(
        val label: String,
        val isPlaceholder: Boolean = false
    )

    private fun repaintDetail() {
        detailPanel.revalidate(); detailPanel.repaint()
        detailScroll.verticalScrollBar.value = 0
    }
}
