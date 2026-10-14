package com.coraiworker.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import com.coraiworker.android.data.AuthDataStore
import com.coraiworker.android.ui.login.LoginScreen
import com.coraiworker.android.ui.main.MainScreen
import com.coraiworker.android.ui.theme.CorAiWorkerTheme
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CorAiWorkerTheme {
                AppRoot()
            }
        }
    }
}

@Composable
fun AppRoot() {
    val context = LocalContext.current
    val dataStore = remember { AuthDataStore(context) }
    val scope = rememberCoroutineScope()

    var token by remember { mutableStateOf<String?>(null) }
    var userId by remember { mutableStateOf<String?>(null) }
    var serverUrl by remember { mutableStateOf(AuthDataStore.DEFAULT_SERVER_URL) }
    var initialized by remember { mutableStateOf(false) }

    // 持续监听 DataStore，任意字段变化时自动重组
    LaunchedEffect(Unit) {
        combine(
            dataStore.tokenFlow,
            dataStore.userIdFlow,
            dataStore.serverUrlFlow
        ) { t, u, url -> Triple(t, u, url) }
            .collect { (t, u, url) ->
                token = t
                userId = u
                serverUrl = url
                initialized = true
            }
    }

    // 等待 DataStore 首次读取，避免闪屏
    if (!initialized) return

    if (token.isNullOrBlank() || userId.isNullOrBlank()) {
        LoginScreen(
            onLoginSuccess = {
                // DataStore 写入后 LaunchedEffect 自动收到新值并触发重组
            }
        )
    } else {
        MainScreen(
            token = token!!,
            currentUserId = userId!!,
            serverUrl = serverUrl,
            onLogout = {
                // 清除登录态 → LaunchedEffect 收到空值 → 重组回登录页
                scope.launch { dataStore.clearAuth() }
            }
        )
    }
}
