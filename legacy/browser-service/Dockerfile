# 使用 Debian slim（不能用 Alpine，Playwright 需要 glibc）
FROM python:3.12-slim

WORKDIR /app

# 统一 Playwright 浏览器安装路径（安装和运行时必须一致）
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 安装系统依赖（用 playwright install --with-deps 自动处理，这里只补字体和证书）
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 安装 Playwright Chromium 及其系统依赖（--with-deps 自动 apt-get 所需库）
RUN playwright install chromium --with-deps

COPY main.py .

EXPOSE 7788

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7788"]
