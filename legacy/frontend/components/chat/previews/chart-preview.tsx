"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ChartPreviewProps {
  code: string;
  isDark?: boolean;
  onRetry?: (errorMsg: string) => void;
}

/**
 * ECharts 图表预览组件
 * 通过 iframe + srcdoc 沙箱渲染，从 unpkg CDN 加载 ECharts
 * 支持 dark/light 主题跟随，渲染失败时显示错误 + 一键重试
 */
export function ChartPreview({ code, isDark = true, onRetry }: ChartPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const theme = isDark ? "dark" : "light";

  // 构建 iframe 内的完整 HTML
  const buildSrcdoc = (chartCode: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: ${isDark ? "#1a1a2e" : "#ffffff"};
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  #chart { width: 100%; height: 300px; }
  .err {
    color: #ef4444;
    font-family: monospace;
    font-size: 12px;
    padding: 16px;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
</head>
<body>
<div id="chart"></div>
<script src="/echarts.min.js"></script>
<script>
(function() {
  try {
    var rawCode = ${JSON.stringify(chartCode)};
    var option = null;

    // 策略1：直接 JSON.parse（AI 输出纯 JSON 对象时）
    try {
      option = JSON.parse(rawCode);
    } catch(_) {}

    // 策略2：eval 对象字面量（带注释或 JS 表达式时）
    if (typeof option !== 'object' || option === null) {
      try {
        option = eval('(' + rawCode + ')');
      } catch(_) {}
    }

    // 策略3：IIFE 执行（代码里有 return 语句时）
    if (typeof option !== 'object' || option === null) {
      option = (new Function(rawCode))();
    }

    if (typeof option !== 'object' || option === null) {
      throw new Error('无法解析 ECharts option，请检查代码格式');
    }

    var chart = echarts.init(document.getElementById('chart'), '${theme}');
    chart.setOption(option);
    // 通知父页面实际高度
    window.parent.postMessage({ type: 'chart-ready', height: document.body.scrollHeight }, '*');
  } catch(e) {
    document.getElementById('chart').innerHTML = '<div class="err">渲染失败：' + e.message + '</div>';
    window.parent.postMessage({ type: 'chart-error', message: e.message }, '*');
  }
})();
</script>
</body>
</html>`;

  useEffect(() => {
    setError(null);
    setLoading(true);

    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "chart-ready") {
        setLoading(false);
        if (e.data.height > 60) setHeight(Math.min(e.data.height + 24, 600));
      } else if (e.data?.type === "chart-error") {
        setLoading(false);
        setError(e.data.message ?? "未知渲染错误");
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [code, isDark]);

  return (
    <div style={{ position: "relative", borderRadius: "6px", overflow: "hidden" }}>
      {/* 加载中占位 */}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isDark ? "#1a1a2e" : "#f8f8f8",
            zIndex: 1,
            gap: "8px",
            color: "var(--text-muted)",
            fontSize: "13px",
          }}
        >
          <span
            style={{
              width: "14px",
              height: "14px",
              border: "2px solid rgba(99,102,241,0.3)",
              borderTopColor: "rgba(99,102,241,0.9)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              display: "inline-block",
            }}
          />
          图表渲染中...
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div
          style={{
            padding: "12px 14px",
            backgroundColor: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "6px",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <AlertCircle size={14} style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "12px", color: "#ef4444", marginBottom: "6px" }}>
              ECharts 渲染失败：{error}
            </div>
            {onRetry && (
              <button
                onClick={() => onRetry(error)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 10px",
                  borderRadius: "4px",
                  border: "1px solid rgba(239,68,68,0.3)",
                  backgroundColor: "transparent",
                  color: "#ef4444",
                  fontSize: "12px",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <RefreshCw size={11} />
                让 AI 修复
              </button>
            )}
          </div>
        </div>
      )}

      {/* iframe 沙箱 */}
      {!error && (
        <iframe
          ref={iframeRef}
          srcDoc={buildSrcdoc(code)}
          sandbox="allow-scripts"
          style={{
            width: "100%",
            height: `${height}px`,
            border: "none",
            display: "block",
            opacity: loading ? 0 : 1,
            transition: "opacity 0.3s ease",
          }}
          title="ECharts 图表预览"
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
