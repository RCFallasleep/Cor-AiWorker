# PRD · Android Breakpoint AI Analyzer（插件 + Lobi Skill 双端）

## 背景

Android Studio 调试时，断点命中后变量信息只存在于 IDE 内部，AI 无法直接读取。
本系统通过「AS 插件 + Lobi Skill」双端打通，实现：
1. **Lobi 主动推荐断点**：结合 code-search 分析代码，在 AS 代码界面显示断点 hint
2. **插件自动采集**：断点命中后采集变量 + 调用栈 + 多断点 diff，推送给 Lobi
3. **Lobi AI 分析**：结合静态代码 + 运行时数据，给出有锚点的分析结论

---

## 目标用户

Android 开发新手，在小红书内网环境使用 Android Studio 调试。

---

## 系统架构

```
┌─────────────────────────────┐     HTTP      ┌──────────────────────────────┐
│     Android Studio 插件      │               │        Lobi (OpenClaw)        │
│                             │               │                              │
│  断点命中 → 采集变量+调用栈   │ ──POST 18765→ │  /analyze 接口               │
│  多断点 diff 汇总            │               │  → 结合 code-search 分析      │
│  侧边面板展示分析结论         │ ←POST 18766── │  → 返回分析结论 + 推荐断点    │
│  Gutter Icon 渲染推荐断点    │               │  /recommend 接口             │
└─────────────────────────────┘               └──────────────────────────────┘
         localhost                                      localhost
```

### 端口约定
| 端口 | 服务方 | 用途 |
|------|--------|------|
| 18765 | Lobi | 接收插件推送的断点数据，返回分析结论 |
| 18766 | AS 插件 | 接收 Lobi 推送的断点推荐，渲染 Gutter Icon |

---

## 工作模式（继承自 android-breakpoint-analyzer Skill）

Skill 支持双模式，由用户在对话中声明意图：

- **探索模式**：理解代码逻辑、执行路径，只分析不提修复建议
- **Debug 模式**：追查 bug，提出修复建议（用户决定是否采纳），输出格式 CodeWiz 可直接执行

两个模式都可以独立触发「推荐断点」和「断点数据分析」，无顺序依赖。

---

## v1 功能范围（当前版本）

### 【插件端】

#### F1：监听断点命中
- 监听 AS 调试会话中的断点暂停事件（`XDebugSessionListener.sessionPaused()`）
- 不处理：异常断点、watchpoint、条件断点命中失败等边缘情况

#### F2：自动采集调试信息

```kotlin
data class BreakpointSnapshot(
    val sessionId: String,         // 会话 ID（用户命名或自动生成）
    val breakpointId: Int,         // 本次会话内的断点序号
    val file: String,              // 文件名，如 "ImageCompressor.kt"
    val className: String,
    val method: String,
    val line: Int,
    val callStack: List<StackFrame>,   // 最多 10 层
    val variables: List<Variable>,
    val timestamp: Long
)

data class StackFrame(val className: String, val method: String, val line: Int, val file: String)

data class Variable(
    val name: String,
    val value: String,       // 超 200 字符截断加 ...(truncated)
    val type: String,
    val children: List<Variable> = emptyList()  // 递归最多 3 层
)
```

**采集规则：**
- 只采集当前栈帧局部变量（不采集全局/静态变量）
- 集合类型最多展开 10 个元素

#### F3：多断点 diff 汇总

插件本地完整存储每个断点的 snapshot（全量），推送给 Lobi 时使用精简的 diff 格式：

```json
{
  "session": "会话名称",
  "mode": "auto",
  "breakpoints": [
    {
      "id": 1,
      "location": "ImageCompressor.kt · compressIfNeeded() · L47",
      "keyVars": { "ratio": 1.0, "isOriginal": true }
    },
    {
      "id": 2,
      "location": "ImageCompressor.kt · scaleDown() · L83",
      "keyVars": { "ratio": 1.33, "isOriginal": true },
      "diff_from_prev": {
        "changed": { "ratio": "1.0 → 1.33" },
        "unchanged": ["isOriginal", "config.maxSideLimit"]
      }
    }
  ],
  "callStackDiff": "断点#2 比 #1 多了 scaleDown() 这一层",
  "rawAvailable": true
}
```

`rawAvailable: true` 表示 Lobi 可以按需发请求拉某个断点的完整原始数据。

#### F4：推送给 Lobi

```
POST http://localhost:18765/analyze
Content-Type: application/json
Body: 上述 diff 汇总 JSON
```

超时 3 秒，静默失败，面板显示错误提示。

#### F5：侧边面板（AI Debugger Tool Window）

左侧：会话列表 + 历史会话（持久化到 `~/.ai-debugger/sessions/`，重启 IDE 可恢复）
右侧：当前断点详情

```
📍 断点位置       文件 · 方法 · 行号
🔗 调用路径       简洁版调用链
📋 完整调用栈     带编号，最多 10 层
🔢 局部变量       嵌套展开
🧠 AI 分析结论   来自 Lobi 的 markdown，渲染展示
🤖 CodeWiz 指令  可一键复制的修复建议（Debug 模式）
```

- 断点命中自动展示面板
- 加载中显示 loading 状态
- 接口返回前不清空上次结果

#### F6：Settings 配置页

路径：Android Studio → Settings → Tools → AI Debugger

| 配置 | 默认值 | 说明 |
|------|--------|------|
| Lobi Analyze Endpoint | `http://localhost:18765/analyze` | Lobi 分析接口地址 |
| 插件监听端口 | 18766 | 接收 Lobi 推送的端口 |
| 自动触发分析 | 开启 | 断点命中时是否自动推送 |
| 变量递归深度 | 3 | 嵌套对象展开层数（1-5）|
| 集合最大元素数 | 10 | List/Map 最多展开几个元素 |

---

### 【Lobi Skill 端】

#### S1：启动本地 HTTP server

Skill 激活后，在 `localhost:18765` 起一个 HTTP server：
- `POST /analyze`：接收断点数据 → AI 分析 → 返回结论
- `POST /raw`：接收断点 ID → 返回该断点的完整原始 snapshot（按需拉取）

server 脚本位于 `skills/android-breakpoint-analyzer/scripts/analyze-server.py`。

**启动方式：**
```bash
python3 skills/android-breakpoint-analyzer/scripts/analyze-server.py
```

#### S2：/analyze 接口处理逻辑

```
收到 diff JSON
    ↓
格式化成分析 prompt（含断点位置、变量 diff、调用栈变化）
    ↓
调用 AI 分析（探索模式 or Debug 模式）
    ↓
返回 JSON：
{
  "analysis": "<markdown 分析结论>",
  "codewiz_instruction": "<可选，Debug 模式下的修复指令>",
  "need_raw": [2]   // 可选，告知插件需要断点#2的完整数据
}
```

#### S3：结合 code-search（双模式）

- **探索模式**：用 code-search 拉静态代码 → 结合运行时变量 → 解释执行路径
- **Debug 模式**：用 code-search 找上下文 → 定位根因 → 输出 CodeWiz 可执行的修复指令

#### S4：连接状态检查

Skill 启动时检查 18765 端口是否已占用，避免重复启动。
提示用户：「服务已启动，请在 AS 插件的 Settings 中确认 Endpoint 为 http://localhost:18765/analyze」

---

## 技术要求（插件端）

### 开发环境
- **开发 IDE**：IntelliJ IDEA 2024.1.3（需安装 Plugin DevKit）
- **语言**：Kotlin
- **构建**：Gradle + `org.jetbrains.intellij` v1.17.3
- **目标平台**：Android Studio Hedgehog（2023.1.1）及以上
- **JDK**：17

### build.gradle.kts 关键配置

```kotlin
plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("org.jetbrains.intellij") version "1.17.3"
}

intellij {
    localPath.set("/Applications/Android Studio.app/Contents") // macOS
    plugins.set(listOf("org.jetbrains.android"))
}

dependencies {
    implementation(kotlin("stdlib"))
    implementation(kotlin("reflect"))
    // 插件内嵌 HTTP server（接收 Lobi 推送）
    implementation("fi.iki.elonen:nanohttpd:2.3.1")
}
```

### plugin.xml 关键依赖

```xml
<depends>com.intellij.modules.platform</depends>
<depends>com.intellij.modules.lang</depends>
<depends>org.jetbrains.kotlin</depends>
<depends>org.jetbrains.android</depends>
```

### 关键 API

**① 监听断点命中**
```kotlin
project.messageBus.connect().subscribe(
    XDebuggerManager.TOPIC,
    object : XDebuggerManagerListener {
        override fun processStarted(debugProcess: XDebugProcess) {
            debugProcess.session.addSessionListener(object : XDebugSessionListener {
                override fun sessionPaused() {
                    val frame = debugProcess.session.currentStackFrame ?: return
                    collectVariables(frame)
                }
            })
        }
    }
)
```

**② 读取变量（异步回调）**
```kotlin
frame.computeChildren(object : XCompositeNode {
    override fun addChildren(children: XValueChildrenList, last: Boolean) {
        for (i in 0 until children.size()) {
            val xValue = children.getValue(i)
            xValue.computePresentation(object : XValueNode {
                override fun setPresentation(...) { /* value 在这里 */ }
            }, XValuePlace.TREE)
        }
    }
    // 其余 override 空实现
})
```

**③ 获取方法名 + 行号**
```kotlin
val methodName = (frame as? JavaStackFrame)?.stackFrameProxy?.location()?.method()?.name() ?: "unknown"
val fileName = frame.sourcePosition?.file?.name ?: "unknown"
val lineNumber = frame.sourcePosition?.line ?: -1
```

**④ 读取调用栈**
```kotlin
val frames = debugProcess.session.suspendContext
    ?.executionStacks?.firstOrNull()
    ?.computeStackFrames(10)
```

**⑤ 插件内嵌 HTTP server（NanoHTTPD）**
```kotlin
class PluginServer(port: Int) : NanoHTTPD(port) {
    override fun serve(session: IHTTPSession): Response {
        // 解析 Lobi POST 过来的推荐断点数据
        // 渲染 Gutter Icon（v1 先预留接口，v2 实现）
    }
}
```

### 异步处理原则
- 变量采集全程异步，用 `CompletableFuture` 或协程收敛
- UI 更新必须在 EDT：`ApplicationManager.getApplication().invokeLater { ... }`

---

## 不做（明确排除）

- 不做变量修改功能
- 不做断点管理（添加/删除断点）
- 不做性能分析（CPU/内存 profiling）
- 不支持非 Android 项目
- 不做云端同步

---

## 验收标准

### 插件端
1. 断点命中后，侧边面板 5 秒内展示变量 + 调用栈（AI 接口未启动时也应展示原始数据）
2. 多断点 diff 正确计算（变化的变量标出，未变化的标记 unchanged）
3. 会话记录持久化，重启 IDE 后可恢复历史会话
4. Settings 页配置生效（端口修改重启后生效）
5. 插件不影响正常调试流程（不卡顿、不崩溃）

### Lobi Skill 端
1. 激活 Skill 后，`localhost:18765` 可正常接收 POST 请求
2. 收到断点数据后，5 秒内返回分析结论（markdown 格式）
3. 探索模式：输出执行路径分析 + 关键变量说明
4. Debug 模式：输出根因分析 + CodeWiz 可执行的修复指令
5. 端口冲突时给出明确提示

---

## 交付物

### 插件端
- 可运行的 Gradle 插件项目源码
- 打包好的 `.zip`（可直接在 AS 中 Install Plugin from Disk）
- README：如何配置 Endpoint + 如何与 Lobi Skill 配合使用

### Lobi Skill 端
- `skills/android-breakpoint-analyzer/scripts/analyze-server.py`
- 更新 `skills/android-breakpoint-analyzer/SKILL.md`：说明如何启动 server

---

## 版本规划

### v1（当前）
- 插件端：断点采集 + 多断点 diff + 会话管理 + 持久化 + 面板展示
- Lobi 端：HTTP server + AI 分析（探索/Debug 双模式）+ code-search 集成

### v2（迭代）
**Lobi → AS 反向推送：推荐断点 + Gutter Icon**

Lobi 通过 code-search 找到推荐断点位置后，POST 到插件的 18766 端口，插件在对应代码行旁渲染 💡 Gutter Icon，用户点击可直接添加断点。

技术要点：
- 插件端：`GutterIconRenderer` 实现行号图标，`NanoHTTPD` 接收推荐数据（v1 已预留接口）
- Lobi 端：新增 `/recommend` 推送逻辑
- Settings 新增「本地仓库根目录」配置，用于 code-search 路径 → 本地绝对路径映射

---

## 参考资料

- [IntelliJ Platform SDK · XDebugger](https://plugins.jetbrains.com/docs/intellij/debugging.html)
- [Tool Windows](https://plugins.jetbrains.com/docs/intellij/tool-windows.html)
- [Plugin Gradle Setup](https://plugins.jetbrains.com/docs/intellij/gradle-prerequisites.html)
- [NanoHTTPD](https://github.com/NanoHttpd/nanohttpd)