package com.coraiworker.android.ui.main.messages

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coraiworker.android.data.ApiClient
import com.coraiworker.android.data.CollabWebSocket
import com.coraiworker.android.data.WsEvent
import com.coraiworker.android.data.model.Message
import com.coraiworker.android.data.model.SendMessageRequest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    token: String,
    currentUserId: String,
    serverUrl: String,
    peerId: String,
    peerName: String,
    onBack: () -> Unit
) {
    val api = remember(serverUrl) { ApiClient.buildService(serverUrl) }
    val bearer = ApiClient.bearerToken(token)
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
    var input by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }

    // ── 初始加载历史消息 ──────────────────────────────────────────────────────
    fun loadMessages() {
        scope.launch {
            try {
                messages = api.getMessages(bearer, peerId)
            } catch (e: Exception) {
                // ignore，保留已有消息
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(peerId) { loadMessages() }

    // 新消息时滚动到底部
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    // ── WebSocket 实时接收 ────────────────────────────────────────────────────
    DisposableEffect(serverUrl, token, peerId) {
        val ws = CollabWebSocket(serverUrl, token)
        ws.connect()

        val job = scope.launch {
            ws.events.collect { event ->
                when (event) {
                    is WsEvent.NewMessage -> {
                        // 只处理当前对话的消息，且不重复添加自己发的（已乐观更新）
                        if (event.senderId == peerId && event.receiverId == currentUserId) {
                            val incoming = Message(
                                id = event.id,
                                conversationId = event.conversationId,
                                senderId = event.senderId,
                                receiverId = event.receiverId,
                                content = event.content,
                                createdAt = event.createdAt
                            )
                            // 避免重复（乐观更新的消息已经在列表里）
                            if (messages.none { it.id == incoming.id }) {
                                messages = messages + incoming
                            }
                        }
                    }
                    else -> Unit
                }
            }
        }

        onDispose {
            job.cancel()
            ws.disconnect()
        }
    }

    // ── 发送消息 ──────────────────────────────────────────────────────────────
    fun sendMessage() {
        val content = input.trim()
        if (content.isBlank() || sending) return
        input = ""
        sending = true

        // 乐观更新：先在本地显示
        val optimistic = Message(
            id = "opt-${System.currentTimeMillis()}",
            conversationId = "",
            senderId = currentUserId,
            receiverId = peerId,
            content = content,
            createdAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.getDefault())
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(Date())
        )
        messages = messages + optimistic

        scope.launch {
            try {
                val sent = api.sendMessage(bearer, SendMessageRequest(peerId, content))
                // 用服务端返回的真实消息替换乐观消息
                messages = messages.map { if (it.id == optimistic.id) sent else it }
            } catch (e: Exception) {
                // 发送失败，移除乐观消息
                messages = messages.filter { it.id != optimistic.id }
            } finally {
                sending = false
            }
        }
    }

    // ── UI ───────────────────────────────────────────────────────────────────
    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = peerName.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                            color = Color.White,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(text = peerName, style = MaterialTheme.typography.titleMedium)
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "返回"
                    )
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.surface
            ),
            modifier = Modifier.statusBarsPadding()
        )

        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))

        // 消息列表
        Box(modifier = Modifier.weight(1f)) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.primary
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(messages, key = { it.id }) { msg ->
                        MessageBubble(
                            msg = msg,
                            isMine = msg.senderId == currentUserId
                        )
                    }
                }
            }
        }

        // 输入框
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surface)
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                placeholder = {
                    Text(
                        "输入消息...",
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(20.dp),
                maxLines = 4,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outline,
                    focusedTextColor = MaterialTheme.colorScheme.onSurface,
                    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                    cursorColor = MaterialTheme.colorScheme.primary,
                )
            )
            Spacer(modifier = Modifier.width(8.dp))
            IconButton(
                onClick = { sendMessage() },
                enabled = input.isNotBlank() && !sending,
                modifier = Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(
                        if (input.isNotBlank() && !sending)
                            MaterialTheme.colorScheme.primary
                        else
                            MaterialTheme.colorScheme.surfaceVariant
                    )
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = "发送",
                    tint = if (input.isNotBlank() && !sending) Color.White
                    else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

// ── 消息气泡 ──────────────────────────────────────────────────────────────────

@Composable
private fun MessageBubble(msg: Message, isMine: Boolean) {
    val bubbleColor = if (isMine)
        MaterialTheme.colorScheme.primary
    else
        MaterialTheme.colorScheme.surfaceVariant

    val textColor = if (isMine)
        Color.White
    else
        MaterialTheme.colorScheme.onSurface

    val timeStr = try {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val date = sdf.parse(msg.createdAt.substringBefore(".").substringBefore("Z"))
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(date ?: Date())
    } catch (_: Exception) { "" }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isMine) Alignment.End else Alignment.Start
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isMine) 16.dp else 4.dp,
                        bottomEnd = if (isMine) 4.dp else 16.dp
                    )
                )
                .background(bubbleColor)
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(
                text = msg.content,
                color = textColor,
                fontSize = 14.sp,
                lineHeight = 20.sp
            )
        }
        if (timeStr.isNotEmpty()) {
            Text(
                text = timeStr,
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.padding(top = 2.dp, start = 4.dp, end = 4.dp)
            )
        }
    }
}
