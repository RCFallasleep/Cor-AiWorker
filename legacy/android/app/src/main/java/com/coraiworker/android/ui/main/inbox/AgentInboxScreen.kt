package com.coraiworker.android.ui.main.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coraiworker.android.data.ApiClient
import com.coraiworker.android.data.CollabWebSocket
import com.coraiworker.android.data.WsEvent
import com.coraiworker.android.data.model.AgentInboxMessage
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

// ── 消息类型配置 ──────────────────────────────────────────────────────────────

private data class MsgTypeConfig(
    val label: String,
    val color: Color,
    val bgColor: Color
)

private val MSG_TYPE_MAP = mapOf(
    "agent_forward" to MsgTypeConfig("Agent转发", Color(0xFF818CF8), Color(0x1A6366F1)),
    "task_remind"   to MsgTypeConfig("任务提醒", Color(0xFFF59E0B), Color(0x1AF59E0B)),
    "task_report"   to MsgTypeConfig("任务汇报", Color(0xFF10B981), Color(0x1A10B981)),
    "system"        to MsgTypeConfig("系统通知", Color(0xFF6B7280), Color(0x1A6B7280))
)

private fun typeConfig(msgType: String) =
    MSG_TYPE_MAP[msgType] ?: MSG_TYPE_MAP["system"]!!

private fun formatTime(isoStr: String): String = try {
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    val date = sdf.parse(isoStr.substringBefore(".").substringBefore("Z"))
        ?: return isoStr
    SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(date)
} catch (_: Exception) { isoStr }

// ── 主屏幕 ────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentInboxScreen(
    token: String,
    serverUrl: String,
    /** 外部传入，用于在进入本页时清零角标 */
    onClearBadge: () -> Unit = {}
) {
    val api = remember(serverUrl) { ApiClient.buildService(serverUrl) }
    val bearer = ApiClient.bearerToken(token)
    val scope = rememberCoroutineScope()

    var messages by remember { mutableStateOf<List<AgentInboxMessage>>(emptyList()) }
    var unreadCount by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var selectedMsg by remember { mutableStateOf<AgentInboxMessage?>(null) }
    var filterType by remember { mutableStateOf("all") }  // all / unread / agent_forward / task_remind / task_report

    // 加载消息列表
    fun loadMessages() {
        scope.launch {
            loading = true
            try {
                val resp = api.listAgentInbox(bearer, limit = 100)
                messages = resp.messages
                unreadCount = resp.unreadCount
            } catch (_: Exception) {
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loadMessages()
        onClearBadge()
    }

    // WebSocket 实时接收新消息
    DisposableEffect(serverUrl, token) {
        val ws = CollabWebSocket(serverUrl, token)
        ws.connect()
        val job = scope.launch {
            ws.events.collect { event ->
                if (event is WsEvent.AgentInboxNewMessage) {
                    // 重新拉取列表（简单可靠）
                    loadMessages()
                }
            }
        }
        onDispose {
            job.cancel()
            ws.disconnect()
        }
    }

    // 过滤后的消息
    val filtered = when (filterType) {
        "unread"        -> messages.filter { it.isUnread }
        "agent_forward" -> messages.filter { it.msgType == "agent_forward" }
        "task_remind"   -> messages.filter { it.msgType == "task_remind" }
        "task_report"   -> messages.filter { it.msgType == "task_report" }
        else            -> messages
    }

    // 如果有选中消息，显示详情页；否则显示列表页
    if (selectedMsg != null) {
        InboxDetailScreen(
            msg = selectedMsg!!,
            onBack = { selectedMsg = null },
            onMarkRead = { msg ->
                if (msg.isUnread) {
                    scope.launch {
                        try {
                            api.markInboxRead(bearer, msg.id)
                            messages = messages.map {
                                if (it.id == msg.id) it.copy(readAt = "read") else it
                            }
                            unreadCount = maxOf(0, unreadCount - 1)
                            selectedMsg = selectedMsg?.let {
                                if (it.id == msg.id) it.copy(readAt = "read") else it
                            }
                        } catch (_: Exception) {}
                    }
                }
            },
            onDelete = { msg ->
                scope.launch {
                    try {
                        api.deleteInboxMessage(bearer, msg.id)
                        if (msg.isUnread) unreadCount = maxOf(0, unreadCount - 1)
                        messages = messages.filter { it.id != msg.id }
                        selectedMsg = null
                    } catch (_: Exception) {}
                }
            }
        )
        return
    }

    // ── 列表页 ────────────────────────────────────────────────────────────────
    Column(modifier = Modifier.fillMaxSize()) {

        // 顶部栏
        TopAppBar(
            title = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Agent 收件箱", fontWeight = FontWeight.SemiBold)
                    if (unreadCount > 0) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF6366F1))
                                .padding(horizontal = 7.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = if (unreadCount > 99) "99+" else unreadCount.toString(),
                                color = Color.White,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            },
            actions = {
                // 全部已读
                if (unreadCount > 0) {
                    IconButton(onClick = {
                        scope.launch {
                            try {
                                api.markAllInboxRead(bearer)
                                messages = messages.map { it.copy(readAt = "read") }
                                unreadCount = 0
                            } catch (_: Exception) {}
                        }
                    }) {
                        Icon(Icons.Outlined.DoneAll, contentDescription = "全部已读")
                    }
                }
                // 刷新
                IconButton(onClick = { loadMessages() }) {
                    Icon(Icons.Outlined.Refresh, contentDescription = "刷新")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        )

        // 过滤 Tab 行
        FilterTabRow(
            selected = filterType,
            onSelect = { filterType = it }
        )

        HorizontalDivider()

        // 消息列表
        if (loading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (filtered.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Outlined.Inbox,
                        contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = if (filterType == "unread") "没有未读消息" else "收件箱为空",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 14.sp
                    )
                    Text(
                        text = "来自其他 Agent 的消息和任务提醒会出现在这里",
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(filtered, key = { it.id }) { msg ->
                    InboxListItem(
                        msg = msg,
                        onClick = {
                            selectedMsg = msg
                            // 点击即标记已读
                            if (msg.isUnread) {
                                scope.launch {
                                    try {
                                        api.markInboxRead(bearer, msg.id)
                                        messages = messages.map {
                                            if (it.id == msg.id) it.copy(readAt = "read") else it
                                        }
                                        unreadCount = maxOf(0, unreadCount - 1)
                                        selectedMsg = selectedMsg?.let {
                                            if (it.id == msg.id) it.copy(readAt = "read") else it
                                        }
                                    } catch (_: Exception) {}
                                }
                            }
                        },
                        onDelete = {
                            scope.launch {
                                try {
                                    api.deleteInboxMessage(bearer, msg.id)
                                    if (msg.isUnread) unreadCount = maxOf(0, unreadCount - 1)
                                    messages = messages.filter { it.id != msg.id }
                                } catch (_: Exception) {}
                            }
                        }
                    )
                    HorizontalDivider(thickness = 0.5.dp)
                }
            }
        }
    }
}

// ── 过滤 Tab 行 ───────────────────────────────────────────────────────────────

@Composable
private fun FilterTabRow(selected: String, onSelect: (String) -> Unit) {
    val tabs = listOf(
        "all" to "全部",
        "unread" to "未读",
        "agent_forward" to "转发",
        "task_remind" to "提醒",
        "task_report" to "汇报"
    )
    ScrollableTabRow(
        selectedTabIndex = tabs.indexOfFirst { it.first == selected }.coerceAtLeast(0),
        containerColor = MaterialTheme.colorScheme.surface,
        edgePadding = 12.dp,
        divider = {}
    ) {
        tabs.forEach { (key, label) ->
            Tab(
                selected = selected == key,
                onClick = { onSelect(key) },
                text = {
                    Text(
                        label,
                        fontSize = 13.sp,
                        fontWeight = if (selected == key) FontWeight.SemiBold else FontWeight.Normal
                    )
                }
            )
        }
    }
}

// ── 列表条目 ──────────────────────────────────────────────────────────────────

@Composable
private fun InboxListItem(
    msg: AgentInboxMessage,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    val cfg = typeConfig(msg.msgType)
    val senderName = msg.senderDisplayName ?: msg.senderUsername ?: "系统"

    var showDeleteConfirm by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 类型图标圆圈
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(cfg.bgColor),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = when (msg.msgType) {
                    "agent_forward" -> Icons.Outlined.AutoAwesome
                    "task_remind"   -> Icons.Outlined.Notifications
                    "task_report"   -> Icons.Outlined.Bolt
                    else            -> Icons.Outlined.Info
                },
                contentDescription = null,
                tint = cfg.color,
                modifier = Modifier.size(18.dp)
            )
        }

        Column(modifier = Modifier.weight(1f)) {
            // 发件人 + 时间
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = senderName + (msg.senderAgentName?.let { " · $it" } ?: ""),
                    fontSize = 13.sp,
                    fontWeight = if (msg.isUnread) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (msg.isUnread) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = formatTime(msg.createdAt),
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(Modifier.height(2.dp))

            // 标题/内容预览
            Text(
                text = msg.title ?: msg.content.take(60),
                fontSize = 13.sp,
                fontWeight = if (msg.isUnread) FontWeight.Medium else FontWeight.Normal,
                color = if (msg.isUnread) MaterialTheme.colorScheme.onSurface
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(5.dp))

            // 类型标签
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .background(cfg.bgColor)
                    .padding(horizontal = 7.dp, vertical = 2.dp)
            ) {
                Text(text = cfg.label, fontSize = 10.sp, color = cfg.color)
            }
        }

        // 未读圆点 + 删除按钮
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (msg.isUnread) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(Color(0xFF6366F1))
                )
            }
            IconButton(
                onClick = { showDeleteConfirm = true },
                modifier = Modifier.size(28.dp)
            ) {
                Icon(
                    Icons.Outlined.DeleteOutline,
                    contentDescription = "删除",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }

    // 删除确认对话框
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除消息") },
            text = { Text("确定要删除这条消息吗？") },
            confirmButton = {
                TextButton(onClick = { showDeleteConfirm = false; onDelete() }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("取消") }
            }
        )
    }
}

// ── 详情页 ────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InboxDetailScreen(
    msg: AgentInboxMessage,
    onBack: () -> Unit,
    onMarkRead: (AgentInboxMessage) -> Unit,
    onDelete: (AgentInboxMessage) -> Unit
) {
    val cfg = typeConfig(msg.msgType)
    val senderName = msg.senderDisplayName ?: msg.senderUsername ?: "系统"
    var showDeleteConfirm by remember { mutableStateOf(false) }

    // 进入详情时自动标记已读
    LaunchedEffect(msg.id) {
        if (msg.isUnread) onMarkRead(msg)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("消息详情", fontWeight = FontWeight.SemiBold) },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回")
                }
            },
            actions = {
                IconButton(onClick = { showDeleteConfirm = true }) {
                    Icon(Icons.Outlined.DeleteOutline, contentDescription = "删除")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        )

        HorizontalDivider()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 类型标签
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(cfg.bgColor)
                    .padding(horizontal = 12.dp, vertical = 5.dp)
            ) {
                Text(text = cfg.label, fontSize = 12.sp, color = cfg.color, fontWeight = FontWeight.Medium)
            }

            // 标题
            Text(
                text = msg.title ?: "（无标题）",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = 28.sp
            )

            // 元信息卡片
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                ),
                shape = RoundedCornerShape(10.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    MetaRow(label = "发件方", value = buildString {
                        append(senderName)
                        msg.senderAgentName?.let { append(" · $it") }
                    })
                    MetaRow(label = "时间", value = formatTime(msg.createdAt))
                    MetaRow(label = "状态", value = if (msg.isUnread) "未读" else "已读")
                    if (msg.taskId != null) {
                        MetaRow(label = "关联任务", value = "ID: ${msg.taskId}")
                    }
                }
            }

            HorizontalDivider()

            // 正文
            Text(
                text = msg.content,
                fontSize = 15.sp,
                lineHeight = 24.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除消息") },
            text = { Text("确定要删除这条消息吗？") },
            confirmButton = {
                TextButton(onClick = { showDeleteConfirm = false; onDelete(msg) }) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun MetaRow(label: String, value: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "$label：",
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(56.dp)
        )
        Text(
            text = value,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
