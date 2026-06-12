# 踩坑记录

> 记录开发过程中遇到的问题、根本原因和解决方案，供换设备或排查问题时参考。

---

## 坑 1：Python 版本与 pydantic-core 不兼容

**现象**：本机 Python 3.14 执行 `pip install -r requirements.txt` 报错，pydantic-core 安装失败。

**根本原因**：pydantic-core 底层用 Rust（PyO3）编写，预编译包只覆盖到 Python 3.13，3.14 没有对应的 wheel，从源码编译又需要完整 Rust 工具链。

**解决方案**：用 Homebrew 单独安装 Python 3.12，重建 venv：
```bash
brew install python@3.12
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**长期方案**：用 `pyenv` 管理多版本，在项目根目录放 `.python-version` 文件锁定版本：
```bash
brew install pyenv
pyenv install 3.12.9
pyenv local 3.12.9
```

---

## 坑 2：Docker 拉取 python:3.12-slim 超时

**现象**：`docker compose up --build` 卡在拉取基础镜像，最终超时失败。

**根本原因**：Docker Hub 在国内访问极慢，`python:3.12-slim` 镜像约 150MB，国内镜像源缓存不全。

**解决方案**：改用 `python:3.12-alpine`，体积仅约 20MB，国内镜像源有完整缓存：
```dockerfile
# 改前
FROM python:3.12-slim

# 改后
FROM python:3.12-alpine
```

**代价**：Alpine 没有 gcc 等编译工具，需要手动安装：
```dockerfile
RUN apk add --no-cache gcc musl-dev libffi-dev
```

---

## 坑 3：SearXNG 启动报 ValidationException（locale 配置无效）

**现象**：SearXNG 容器启动后立即退出，日志显示 `ValidationException`。

**根本原因**：`searxng/settings.yml` 中配置了 `default_locale: "zh"`，SearXNG 的 locale 白名单里没有 `zh`（`zh-Hans`、`zh-Hant` 也均无效）。

**解决方案**：直接删除 `default_locale` 配置项，使用 SearXNG 默认值（`en`）：
```yaml
# 删掉这行
# default_locale: "zh"
```

---

## 坑 4：后端容器显示 Started 但实际已崩溃（pydantic-settings 解析 list 失败）

**现象**：`docker compose up -d` 显示 `cor-backend Started`，但前端请求全部失败，Agent 触发了工具调用却返回"无法联网"。

**根本原因**：`docker-compose.yml` 中环境变量写成逗号分隔格式：
```yaml
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```
pydantic-settings 解析 `list[str]` 类型时不认识逗号分隔，启动时抛出异常，进程立即退出。Docker 只检测进程是否启动（不检测是否存活），所以显示 `Started`，实际上容器已经崩溃。

**解决方案**：改为 JSON 数组格式：
```yaml
ALLOWED_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

**排查方法**：容器显示 Started 但请求失败时，第一步看日志：
```bash
docker logs cor-backend
```

---

## 坑 5：模型不知道"今天"是哪天，用训练截止日期搜索

**现象**：用户问「今天上海的天气」，模型搜索的关键词是「上海天气 2025年1月9日」（训练数据截止日期），回复的天气信息是错误日期的。

**根本原因**：LLM 没有实时感知时间的能力，训练数据截止后它不知道"现在"是哪天，会用训练数据中最后出现的日期作为"今天"。

**解决方案**：在每次 Agent 请求时，后端自动将当前时间注入到 system 消息：
```python
now_str = datetime.now(tz=ZoneInfo("Asia/Shanghai")).strftime("%Y年%m月%d日 %H:%M")
system_hint = f"当前日期时间：{now_str}。请以此作为「今天」的基准，不要使用训练数据中的日期。"
```

**扩展**：前端通过 Geolocation API 获取用户城市，一并注入，解决「附近」「本地」等模糊位置词的歧义。

---

## 通用排查命令

```bash
# 查看所有容器状态
docker compose ps

# 查看后端实时日志
docker logs cor-backend -f

# 查看 SearXNG 实时日志
docker logs cor-searxng -f

# 验证后端是否正常响应
curl http://localhost:8000/health

# 验证 SearXNG 是否能返回搜索结果
curl "http://localhost:8080/search?q=test&format=json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'results: {len(d.get(\"results\", []))}')"

# 强制重建并重启某个服务
docker compose up -d --build backend
```
