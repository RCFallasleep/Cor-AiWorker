"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface MermaidPreviewProps {
  code: string;
  isDark?: boolean;
  onRetry?: (errorMsg: string) => void;
}

/**
 * Mermaid 图表预览组件（流程图、时序图、架构图等）
 * 通过 iframe + srcdoc 沙箱渲染，从 unpkg CDN 加载 Mermaid
 */
export function MermaidPreview({ code, isDark = true, onRetry }: MermaidPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(280);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const mermaidTheme = isDark ? "dark" : "default";

  const buildSrcdoc = (mermaidCode: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: ${isDark ? "#1a1a2e" : "#ffffff"};
    padding: 16px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-height: 100vh;
  }
  #diagram { max-width: 100%; }
  .err {
    color: #ef4444;
    font-family: monospace;
    font-size: 12px;
    padding: 16px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  /* Mermaid 暗色主题文字修正 */
  ${isDark ? `
  .mermaid text { fill: #c9d1d9 !important; }
  .mermaid .label { color: #c9d1d9 !important; }
  ` : ""}
</style>
</head>
<body>
<div id="diagram" class="mermaid">${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
<script type="module">
  import mermaid from 'https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs';
  try {
    mermaid.initialize({
      startOnLoad: true,
      theme: '${mermaidTheme}',
      securityLevel: 'loose',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    });
    await mermaid.run();
    // 通知父页面高度
    setTimeout(() => {
      window.parent.postMessage({
        type: 'mermaid-ready',
        height: document.body.scrollHeight
      }, '*');
    }, 100);
  } catch(e) {
    document.getElementById('diagram').innerHTML = '<div class="err">渲染失败：' + e.message + '</div>';
    window.parent.postMessage({ type: 'mermaid-error', message: e.message }, '*');
  }
</script>
</body>
</html>`;

  useEffect(() => {
    setError(null);
    setLoading(true);

    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "mermaid-ready") {
        setLoading(false);
        if (e.data.height > 60) setHeight(Math.min(e.data.height + 32, 700));
      } else if (e.data?.type === "mermaid-error") {
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
            minHeight: "120px",
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
              Mermaid 渲染失败：{error}
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
          title="Mermaid 图表预览"
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
