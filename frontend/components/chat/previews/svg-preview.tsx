"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, RefreshCw, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface SvgPreviewProps {
  code: string;
  isDark?: boolean;
  onRetry?: (errorMsg: string) => void;
}

/**
 * SVG 内联预览组件
 * SVG 无脚本风险，直接内联渲染，支持缩放控制
 */
export function SvgPreview({ code, isDark = true, onRetry }: SvgPreviewProps) {
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // 验证是否是合法 SVG
  const isValidSvg = code.trim().toLowerCase().startsWith("<svg");

  if (!isValidSvg) {
    const errMsg = "内容不是有效的 SVG（需以 <svg 开头）";
    return (
      <ErrorBlock message={errMsg} onRetry={onRetry} />
    );
  }

  // 简单的 XSS 过滤：移除 script 标签和 on* 事件属性
  const sanitized = code
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "");

  if (error) {
    return <ErrorBlock message={error} onRetry={onRetry} />;
  }

  return (
    <div
      style={{
        borderRadius: "6px",
        overflow: "hidden",
        backgroundColor: isDark ? "#1a1a2e" : "#f8f8f8",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* 缩放控制栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backgroundColor: "rgba(255,255,255,0.03)",
        }}
      >
        <span style={{ fontSize: "11px", color: "var(--text-muted)", marginRight: "auto" }}>
          SVG 预览
        </span>
        <button
          onClick={() => setScale((s) => Math.max(0.25, s - 0.25))}
          title="缩小"
          style={zoomBtnStyle}
        >
          <ZoomOut size={12} />
        </button>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", minWidth: "36px", textAlign: "center" }}>
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => setScale((s) => Math.min(3, s + 0.25))}
          title="放大"
          style={zoomBtnStyle}
        >
          <ZoomIn size={12} />
        </button>
        <button
          onClick={() => setScale(1)}
          title="重置"
          style={zoomBtnStyle}
        >
          <RotateCcw size={12} />
        </button>
      </div>

      {/* SVG 渲染区 */}
      <div
        style={{
          overflow: "auto",
          padding: "16px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          minHeight: "120px",
          maxHeight: "600px",
        }}
      >
        <div
          style={{ transform: `scale(${scale})`, transformOrigin: "top center", transition: "transform 0.2s ease" }}
          dangerouslySetInnerHTML={{ __html: sanitized }}
          onError={() => setError("SVG 渲染失败")}
        />
      </div>
    </div>
  );
}

// ── HTML 沙箱预览组件 ──

interface HtmlPreviewProps {
  code: string;
  isDark?: boolean;
  onRetry?: (errorMsg: string) => void;
}

/**
 * 通用 HTML 沙箱预览组件
 * 通过 iframe srcdoc 渲染，allow-scripts 允许 JS 交互
 *
 * 高度自适应策略：
 * 1. 向 HTML 末尾注入 postMessage 脚本，load 后上报 scrollHeight
 * 2. 父页面监听 message 事件，动态调整 iframe 高度
 * 3. 对完整 HTML 页面（含 <html> 标签）也注入脚本，不跳过
 */
export function HtmlPreview({ code, isDark = true, onRetry }: HtmlPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);
  const [loading, setLoading] = useState(true);

  // 高度上报脚本（注入到所有 HTML 末尾）
  const heightReporterScript = `
<script>
(function() {
  function reportHeight() {
    var h = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    window.parent.postMessage({ type: 'html-ready', height: h }, '*');
  }
  // load 后上报
  window.addEventListener('load', function() {
    setTimeout(reportHeight, 100);
    // 再延迟一次，等图表等异步内容渲染完
    setTimeout(reportHeight, 800);
    setTimeout(reportHeight, 2000);
  });
})();
</script>`;

  // 判断是否是完整 HTML 页面
  const isFullPage = /<html[\s>]/i.test(code);

  let themedHtml: string;
  if (isFullPage) {
    // 完整页面：在 </body> 前注入高度上报脚本
    if (code.includes("</body>")) {
      themedHtml = code.replace("</body>", `${heightReporterScript}\n</body>`);
    } else {
      themedHtml = code + heightReporterScript;
    }
  } else {
    // 片段：包裹完整 HTML 结构
    themedHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body {
    margin: 0;
    padding: 12px;
    background: ${isDark ? "#1a1a2e" : "#ffffff"};
    color: ${isDark ? "#c9d1d9" : "#1f2328"};
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.6;
  }
</style>
</head>
<body>
${code}
${heightReporterScript}
</body>
</html>`;
  }

  useEffect(() => {
    setLoading(true);
    setHeight(400);

    const handleMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "html-ready" && e.data.height > 0) {
        setLoading(false);
        // 限制最大高度 900px，最小 200px
        setHeight(Math.min(Math.max(e.data.height + 24, 200), 900));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [code]);

  // onLoad 兜底：如果 postMessage 没触发（纯静态页面），3s 后强制显示
  const handleLoad = () => {
    setTimeout(() => setLoading(false), 3000);
  };

  return (
    <div style={{ position: "relative", borderRadius: "6px", overflow: "hidden" }}>
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
            minHeight: "80px",
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
          渲染中...
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={themedHtml}
        sandbox="allow-scripts"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          display: "block",
          opacity: loading ? 0 : 1,
          transition: "opacity 0.3s ease, height 0.3s ease",
        }}
        onLoad={handleLoad}
        title="HTML 预览"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── 公共错误块 ──
function ErrorBlock({ message, onRetry }: { message: string; onRetry?: (msg: string) => void }) {
  return (
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
          渲染失败：{message}
        </div>
        {onRetry && (
          <button
            onClick={() => onRetry(message)}
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
  );
}

const zoomBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "22px",
  height: "22px",
  borderRadius: "4px",
  border: "none",
  backgroundColor: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  outline: "none",
};
