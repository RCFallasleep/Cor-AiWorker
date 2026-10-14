#!/bin/bash
# 下载第三方 JS 库到 public/ 目录（不提交到 git）
# 用法：bash scripts/download-libs.sh
# 在 clone 项目后、或部署前执行一次即可

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/../public"

echo "📦 下载第三方 JS 库到 public/ ..."

# ECharts 5（数据图表）
if [ ! -f "$PUBLIC_DIR/echarts.min.js" ]; then
  echo "  → 下载 echarts.min.js ..."
  curl -fsSL "https://unpkg.com/echarts@5/dist/echarts.min.js" -o "$PUBLIC_DIR/echarts.min.js"
  echo "  ✅ echarts.min.js 下载完成"
else
  echo "  ✓ echarts.min.js 已存在，跳过"
fi

# Mermaid 11（流程图）
if [ ! -f "$PUBLIC_DIR/mermaid.min.js" ]; then
  echo "  → 下载 mermaid.min.js ..."
  curl -fsSL "https://unpkg.com/mermaid@11/dist/mermaid.min.js" -o "$PUBLIC_DIR/mermaid.min.js"
  echo "  ✅ mermaid.min.js 下载完成"
else
  echo "  ✓ mermaid.min.js 已存在，跳过"
fi

echo ""
echo "✅ 所有库下载完成，可以启动开发服务器了"
