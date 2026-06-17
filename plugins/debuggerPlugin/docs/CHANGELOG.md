# Changelog

---

## v1.0.1 (2026-04-15)

### 新增功能
- **调试会话概念**：每次新调试进程自动创建独立会话，类似 ChatGPT 对话分组，不同问题互不干扰
- **多断点历史**：同一会话内所有断点按顺序记录，AI 分析时携带完整执行链路上下文
- **左侧会话列表**：历史会话可折叠/展开，右键支持重命名、删除
- **本地 JSON 持久化**：会话数据写入 `~/.ai-debugger/sessions/<项目名>/`，重启 IDE 自动恢复
- **手动新建会话**：顶部"＋ 新会话"按钮，支持自定义命名
- **Step Over 过滤**：通过 `XBreakpointManager` 检查当前行是否有用户断点，忽略 Step Over/Into/Out 产生的暂停

### 技术要点
- `SessionManager` 注册为 `@Service(Level.PROJECT)`，每个项目独立实例，通过 `plugin.xml` 的 `<projectService>` 声明
- `SessionManager` 实现了完整的手写 JSON 序列化/反序列化（无额外依赖），支持嵌套 Variable 树的读写
- `AiDebuggerPanel` 通过订阅 `SessionManager.SessionChangeListener` 被动刷新，避免主动轮询
- 左侧会话列表用 `JPanel + BoxLayout` 动态重建（而非 JList），方便自定义每行高度和交互样式

---

## v1.0.0 (2026-04-15)

### 功能
- 监听 `XDebuggerManagerListener.processStarted()` + `XDebugSessionListener.sessionPaused()` 捕获断点命中
- 异步采集当前栈帧局部变量（递归最多 3 层，集合最多 10 个元素，value 超 200 字符截断）
- 采集最多 10 层调用栈
- POST 快照到 `http://localhost:18765/analyze`，3 秒超时静默失败
- 右侧 "AI Debugger" Tool Window 展示：断点位置、调用路径、变量列表、AI 分析结论（含一键复制修复建议）
- Settings 页（`Tools → AI Debugger`）：API Endpoint、自动触发开关、变量深度、集合大小

### 技术要点
- 变量采集全程异步（`XCompositeNode` + `XValueNode` 回调），用 `CompletableFuture` 链收敛，整体 4 秒超时兜底
- `XValuePresentation.XValueTextRenderer` 需实现 `renderValue(String, TextAttributesKey)` 重载，否则编译报错
- AI 推送用纯 JDK `HttpURLConnection` 实现，无额外依赖；响应解析用正则提取 JSON 字段

---

## 开发障碍记录

| 障碍 | 原因 | 解决方案 |
|------|------|----------|
| JDK 25 导致编译失败 | Kotlin 编译器内部 `JavaVersion.parse()` 不支持 `25.x` 版本号格式 | `gradle.properties` 设置 `org.gradle.java.home` 指向本机 JDK 21 |
| `localPath` 指向 Android Studio 报错 | `org.jetbrains.intellij` v1.17.3 解析 AS 的 Kotlin 插件描述符失败（`xi:include` 找不到引用文件） | 改用 `version = "233.15619.7"` + `type = "IC"` 以 IntelliJ IDEA Community 为编译底座，运行时安装到 AS |
| Android 插件不在 IC 内置列表 | `org.jetbrains.android` 是 AS 专属插件，IC 里没有 | 在 `plugins.set()` 里改为 `"org.jetbrains.android:233.15619.7"` 从插件市场下载对应版本 |
| 安装报版本不兼容（build 251.*） | `untilBuild` 写死了 251，但用户的 AS 是 AI-252.x（Meerkat） | 改为 `untilBuild = "253.*"` 覆盖更多版本 |
| `XCompositeNode` 实现报错 | `XDebuggerTreeNodeHyperlink` 包路径写错（用了 `impl` 包） | 改为正确的 `com.intellij.xdebugger.frame.XDebuggerTreeNodeHyperlink` |
| `XValueTextRenderer` 接口未完整实现 | 漏掉了 `renderValue(String, TextAttributesKey)` 重载方法 | 从 SDK 源码 jar 中查阅接口定义后补全所有抽象方法 |
