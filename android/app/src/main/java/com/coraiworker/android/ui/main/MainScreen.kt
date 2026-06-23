package com.coraiworker.android.ui.main

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Message
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.coraiworker.android.data.ApiClient
import com.coraiworker.android.data.CollabWebSocket
import com.coraiworker.android.data.WsEvent
import com.coraiworker.android.ui.main.board.BoardScreen
import com.coraiworker.android.ui.main.inbox.AgentInboxScreen
import com.coraiworker.android.ui.main.messages.ChatScreen
import com.coraiworker.android.ui.main.messages.MessagesScreen
import com.coraiworker.android.ui.main.projects.ProjectsScreen
import kotlinx.coroutines.launch

sealed class BottomTab(val route: String, val label: String, val icon: ImageVector) {
    object Messages : BottomTab("messages", "消息", Icons.Outlined.Message)
    object Inbox    : BottomTab("inbox",    "收件箱", Icons.Outlined.Inbox)
    object Projects : BottomTab("projects", "项目", Icons.Outlined.FolderOpen)
    object Board    : BottomTab("board",    "协作看板", Icons.Outlined.Dashboard)
}

val bottomTabs = listOf(BottomTab.Messages, BottomTab.Inbox, BottomTab.Projects, BottomTab.Board)

@Composable
fun MainScreen(
    token: String,
    currentUserId: String,
    serverUrl: String,
    onLogout: () -> Unit
) {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    val api = remember(serverUrl) { ApiClient.buildService(serverUrl) }
    val bearer = ApiClient.bearerToken(token)
    val scope = rememberCoroutineScope()

    // Agent 收件箱未读数（用于底部 Tab 角标）
    var inboxUnreadCount by remember { mutableIntStateOf(0) }

    // 启动时拉取未读数
    LaunchedEffect(Unit) {
        try {
            val resp = api.getInboxUnreadCount(bearer)
            inboxUnreadCount = resp.unreadCount
        } catch (_: Exception) {}
    }

    // WebSocket 监听 agent_inbox_message 事件，实时 +1
    DisposableEffect(serverUrl, token) {
        val ws = CollabWebSocket(serverUrl, token)
        ws.connect()
        val job = scope.launch {
            ws.events.collect { event ->
                if (event is WsEvent.AgentInboxNewMessage) {
                    inboxUnreadCount++
                }
            }
        }
        onDispose {
            job.cancel()
            ws.disconnect()
        }
    }

    // 聊天页不显示底部栏
    val showBottomBar = currentDestination?.route?.startsWith("chat/") != true

    Scaffold(
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp
                ) {
                    bottomTabs.forEach { tab ->
                        val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
                        val badgeCount = if (tab is BottomTab.Inbox) inboxUnreadCount else 0

                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                navController.navigate(tab.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                if (badgeCount > 0) {
                                    BadgedBox(
                                        badge = {
                                            Badge {
                                                Text(
                                                    text = if (badgeCount > 99) "99+" else badgeCount.toString()
                                                )
                                            }
                                        }
                                    ) {
                                        Icon(
                                            imageVector = tab.icon,
                                            contentDescription = tab.label,
                                            modifier = Modifier.size(24.dp)
                                        )
                                    }
                                } else {
                                    Icon(
                                        imageVector = tab.icon,
                                        contentDescription = tab.label,
                                        modifier = Modifier.size(24.dp)
                                    )
                                }
                            },
                            label = { Text(tab.label, style = MaterialTheme.typography.labelSmall) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MaterialTheme.colorScheme.primary,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
                            )
                        )
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(modifier = Modifier.padding(innerPadding)) {
            NavHost(
                navController = navController,
                startDestination = BottomTab.Messages.route,
                modifier = Modifier.fillMaxSize()
            ) {
                composable(BottomTab.Messages.route) {
                    MessagesScreen(
                        token = token,
                        currentUserId = currentUserId,
                        serverUrl = serverUrl,
                        onOpenChat = { peerId, peerName ->
                            navController.navigate("chat/$peerId?name=$peerName")
                        },
                        onLogout = onLogout
                    )
                }
                composable(BottomTab.Inbox.route) {
                    AgentInboxScreen(
                        token = token,
                        serverUrl = serverUrl,
                        onClearBadge = { inboxUnreadCount = 0 }
                    )
                }
                composable(BottomTab.Projects.route) {
                    ProjectsScreen()
                }
                composable(BottomTab.Board.route) {
                    BoardScreen()
                }
                composable("chat/{peerId}?name={peerName}") { backStack ->
                    val peerId = backStack.arguments?.getString("peerId") ?: return@composable
                    val peerName = backStack.arguments?.getString("peerName") ?: peerId
                    ChatScreen(
                        token = token,
                        currentUserId = currentUserId,
                        serverUrl = serverUrl,
                        peerId = peerId,
                        peerName = peerName,
                        onBack = { navController.popBackStack() }
                    )
                }
            }
        }
    }
}
