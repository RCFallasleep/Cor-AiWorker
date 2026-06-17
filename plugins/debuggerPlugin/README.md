# AI Debugger Plugin

Android Studio 断点 AI 分析插件。断点命中时自动采集变量 + 调用栈，推送给本地 AI 分析接口，并在右侧侧边面板展示结果。

## 功能

- 断点命中时自动采集当前栈帧的局部变量（嵌套最多 3 层，集合最多 10 个元素）
- 采集最多 10 层调用栈
- POST 快照到本地 AI 分析接口（默认 `http://localhost:18765/analyze`）
- 右侧 **AI Debugger** 面板展示断点位置、调用路径、变量列表和 AI 分析结论
- 即使 AI 接口未启动，也会展示原始采集数据

## 构建与安装

### 前置要求

- JDK 17+
- 本机已安装 Android Studio（macOS 路径：`/Applications/Android Studio.app/Contents`）

### 构建插件

```bash
./gradlew buildPlugin
```

产物位于 `build/distributions/debuggerPlugin-1.0.0-SNAPSHOT.zip`。

### 安装到 Android Studio

1. 打开 Android Studio
2. `Settings` → `Plugins` → ⚙️ → `Install Plugin from Disk...`
3. 选择上述 `.zip` 文件
4. 重启 Android Studio

## 配置 API Endpoint

1. `Settings` → `Tools` → `AI Debugger`
2. 修改 **API Endpoint**（默认：`http://localhost:18765/analyze`）
3. 点击 `Apply`，重启后生效

### AI 接口协议

插件向接口发送 POST 请求：

```json
{
  "snapshot": {
    "file": "ImageCompressor.kt",
    "className": "com.xhs.image.ImageCompressor",
    "method": "compressIfNeeded",
    "line": 47,
    "timestamp": 1234567890000,
    "callStack": [
      { "className": "...", "method": "...", "line": 10, "file": "..." }
    ],
    "variables": [
      { "name": "bitmap", "value": "Bitmap@1a2b3c", "type": "Bitmap", "children": [] }
    ]
  },
  "mode": "auto"
}
```

接口返回 JSON：

```json
{
  "conclusion": "AI 分析结论文本...",
  "suggestion": "可选的修复建议代码..."
}
```

## 其他配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| 自动触发 | 开启 | 断点命中时是否自动推送 |
| 变量递归深度 | 3 | 嵌套对象展开层数（1-5）|
| 集合最大元素数 | 10 | List/Map 最多展开几个元素 |
