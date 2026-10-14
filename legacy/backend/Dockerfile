FROM python:3.12-alpine

WORKDIR /app

# alpine 需要 gcc 等编译工具来构建部分依赖
RUN apk add --no-cache gcc musl-dev libffi-dev

# 安装依赖（单独一层，利用缓存）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源码
COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
