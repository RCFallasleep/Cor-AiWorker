package com.example.aidebugger.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(
    name = "AiDebuggerSettings",
    storages = [Storage("AiDebuggerSettings.xml")]
)
class AiDebuggerSettings : PersistentStateComponent<AiDebuggerSettings.State> {

    data class State(
        /**
         * Cor-AiWorker 后端地址（末尾不含 /）。
         * 默认 http://localhost:8000，Docker 启动后无需修改。
         */
        var backendUrl: String = "http://localhost:8000",
        var variableDepth: Int = 3,
        var collectionMaxSize: Int = 10
    )

    private var myState = State()

    override fun getState(): State = myState

    override fun loadState(state: State) {
        myState = state
    }

    var backendUrl: String
        get() = myState.backendUrl.trimEnd('/')
        set(value) { myState.backendUrl = value.trimEnd('/') }

    var variableDepth: Int
        get() = myState.variableDepth
        set(value) { myState.variableDepth = value.coerceIn(1, 5) }

    var collectionMaxSize: Int
        get() = myState.collectionMaxSize
        set(value) { myState.collectionMaxSize = value.coerceIn(1, 100) }

    companion object {
        @JvmStatic
        fun getInstance(): AiDebuggerSettings =
            ApplicationManager.getApplication().getService(AiDebuggerSettings::class.java)
    }
}
