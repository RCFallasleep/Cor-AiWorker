package com.coraiworker.android.ui.login

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.coraiworker.android.data.ApiClient
import com.coraiworker.android.data.AuthDataStore
import com.coraiworker.android.data.model.LoginRequest
import com.coraiworker.android.data.model.RegisterRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class LoginUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val isLoggedIn: Boolean = false
)

class LoginViewModel(app: Application) : AndroidViewModel(app) {

    private val dataStore = AuthDataStore(app)

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState

    fun login(username: String, password: String, serverUrl: String) {
        if (username.isBlank() || password.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "用户名和密码不能为空")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                // 保存用户填写的服务器地址
                dataStore.saveServerUrl(serverUrl)
                val api = ApiClient.buildService(serverUrl)
                val resp = api.login(LoginRequest(username.trim(), password))
                dataStore.saveAuth(
                    token = resp.accessToken,
                    userId = resp.user.id,
                    username = resp.user.username,
                    displayName = resp.user.displayName
                )
                _uiState.value = _uiState.value.copy(isLoading = false, isLoggedIn = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = parseError(e)
                )
            }
        }
    }

    fun register(username: String, password: String, displayName: String, serverUrl: String) {
        if (username.isBlank() || password.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "用户名和密码不能为空")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                dataStore.saveServerUrl(serverUrl)
                val api = ApiClient.buildService(serverUrl)
                val resp = api.register(RegisterRequest(username.trim(), password, displayName.trim()))
                dataStore.saveAuth(
                    token = resp.accessToken,
                    userId = resp.user.id,
                    username = resp.user.username,
                    displayName = resp.user.displayName
                )
                _uiState.value = _uiState.value.copy(isLoading = false, isLoggedIn = true)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = parseError(e)
                )
            }
        }
    }

    /**
     * 读取上次保存的服务器地址（用于回填输入框）
     */
    suspend fun getSavedServerUrl(): String = dataStore.serverUrlFlow.first()

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    private fun parseError(e: Exception): String {
        val msg = e.message ?: "未知错误"
        return when {
            msg.contains("401") || msg.contains("用户名或密码") -> "用户名或密码错误"
            msg.contains("409") || msg.contains("已存在") -> "用户名已被注册"
            msg.contains("Unable to resolve host") || msg.contains("Failed to connect") ||
            msg.contains("failed to connect") || msg.contains("Connection refused") ->
                "无法连接服务器，请检查服务器地址是否正确"
            msg.contains("timeout") || msg.contains("timed out") ->
                "连接超时，请检查服务器地址和网络"
            else -> msg
        }
    }
}
