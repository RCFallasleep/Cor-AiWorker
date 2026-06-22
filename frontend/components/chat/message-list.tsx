"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Star, Volume2, Trash2, GitFork, ChevronDown, ChevronRight, Eye, Code2 } from "lucide-react";
import type { ChatMessage } from "@/lib/mock-chat-data";
import { AgentFlowChart } from "@/components/chat/agent-flow-chart";
import { ChartPreview } from "@/components/chat/previews/chart-preview";
import { MermaidPreview } from "@/components/chat/previews/mermaid-preview";
import { SvgPreview, HtmlPreview } from "@/components/chat/previews/svg-preview";

// ── 可渲染的语言类型 ──
const RENDERABLE_LANGS = new Set(["echarts", "mermaid", "svg", "html"]);

// ── 流式渲染占位符 ──
function RenderingPlaceholder({ lang }: { lang: string }) {
  const labels: Record<string, string> = {
    echarts: "ECharts 图表",
    mermaid: "Mermaid 图表",
    svg: "SVG 图形",
    html: "HTML 预览",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "12px 14px",
        borderRadius: "6px",
        backgroundColor: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.15)",
        color: "var(--text-muted)",
        fontSize: "13px",
        margin: "8px 0",
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
          flexShrink: 0,
        }}
      />
      {labels[lang] ?? "预览"} 生成中...
    </div>
  );
}

// ── 代码块组件（含语言标签 + 复制按钮 + 可视化预览 Tab）──
function CodeBlock({
  language,
  code,
  isStreaming,
  onRetry,
}: {
  language: string;
  code: string;
  isStreaming?: boolean;
  onRetry?: (lang: string, errorMsg: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  // 可渲染语言默认显示预览 Tab
  const isRenderable = RENDERABLE_LANGS.has(language);
  const [activeTab, setActiveTab] = useState<"preview" | "code">(
    isRenderable ? "preview" : "code"
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRetry = useCallback(
    (errorMsg: string) => {
      onRetry?.(language, errorMsg);
    },
    [language, onRetry]
  );

  // 流式输出中且是可渲染语言 → 显示占位符
  if (isStreaming && isRenderable) {
    return <RenderingPlaceholder lang={language} />;
  }

  return (
    <div
      style={{
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        margin: "8px 0",
      }}
    >
      {/* 代码块顶栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 14px",
          backgroundColor: "rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* 语言标签 */}
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "monospace", marginRight: "auto" }}>
          {language || "code"}
        </span>

        {/* 可渲染语言：代码/预览 Tab 切换 */}
        {isRenderable && (
          <>
            <button
              onClick={() => setActiveTab("preview")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "3px",
                padding: "2px 8px",
                borderRadius: "4px",
                border: "none",
                backgroundColor: activeTab === "preview" ? "rgba(99,102,241,0.2)" : "transparent",
                color: activeTab === "preview" ? "rgba(99,102,241,1)" : "var(--text-muted)",
                fontSize: "12px",
                cursor: "pointer",
                outline: "none",
                transition: "all 0.15s",
              }}
            >
              <Eye size={11} />
              预览
            </button>
            <button
              onClick={() => setActiveTab("code")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "3px",
                padding: "2px 8px",
                borderRadius: "4px",
                border: "none",
                backgroundColor: activeTab === "code" ? "rgba(255,255,255,0.08)" : "transparent",
                color: activeTab === "code" ? "var(--text-secondary)" : "var(--text-muted)",
                fontSize: "12px",
                cursor: "pointer",
                outline: "none",
                transition: "all 0.15s",
              }}
            >
              <Code2 size={11} />
              代码
            </button>
          </>
        )}

        {/* 复制按钮 */}
        <button
          onClick={handleCopy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 8px",
            borderRadius: "4px",
            border: "none",
            backgroundColor: "transparent",
            color: copied ? "var(--online-green)" : "var(--text-secondary)",
            fontSize: "12px",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "已复制" : "Copy"}
        </button>
      </div>

      {/* 预览区 */}
      {isRenderable && activeTab === "preview" && (
        <div style={{ padding: "12px", backgroundColor: "#1a1a2e" }}>
          {language === "echarts" && (
            <ChartPreview code={code} isDark onRetry={handleRetry} />
          )}
          {language === "mermaid" && (
            <MermaidPreview code={code} isDark onRetry={handleRetry} />
          )}
          {language === "svg" && (
            <SvgPreview code={code} isDark onRetry={handleRetry} />
          )}
          {language === "html" && (
            <HtmlPreview code={code} isDark onRetry={handleRetry} />
          )}
        </div>
      )}

      {/* 代码内容（代码 Tab 或不可渲染语言） */}
      {(!isRenderable || activeTab === "code") && (
        <SyntaxHighlighter
          language={language || "text"}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "14px 16px",
            fontSize: "13px",
            lineHeight: "1.6",
            backgroundColor: "#1a1a2e",
          }}
          showLineNumbers={false}
        >
          {code}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

// ── Markdown 渲染器（支持 GFM 表格、任务列表等）──
function MarkdownContent({
  content,
  isStreaming,
  onRetry,
}: {
  content: string;
  isStreaming?: boolean;
  onRetry?: (lang: string, errorMsg: string) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 代码块
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isBlock = match !== null;
          const codeStr = String(children).replace(/\n$/, "");

          if (isBlock) {
            return <CodeBlock language={match[1]} code={codeStr} isStreaming={isStreaming} onRetry={onRetry} />;
          }
          // 行内代码
          return (
            <code
              style={{
                backgroundColor: "rgba(255,255,255,0.08)",
                padding: "1px 5px",
                borderRadius: "4px",
                fontSize: "0.88em",
                fontFamily: "monospace",
                color: "#e2b96f",
              }}
              {...props}
            >
              {children}
            </code>
          );
        },
        // 段落
        p({ children }) {
          return (
            <p style={{ margin: "4px 0 10px", lineHeight: "1.75", color: "var(--text-primary)" }}>
              {children}
            </p>
          );
        },
        // 有序列表
        ol({ children }) {
          return (
            <ol style={{ margin: "6px 0 10px", paddingLeft: "22px", lineHeight: "1.8" }}>
              {children}
            </ol>
          );
        },
        // 无序列表
        ul({ children }) {
          return (
            <ul style={{ margin: "6px 0 10px", paddingLeft: "22px", lineHeight: "1.8" }}>
              {children}
            </ul>
          );
        },
        li({ children }) {
          return (
            <li style={{ color: "var(--text-primary)", marginBottom: "4px" }}>
              {children}
            </li>
          );
        },
        // 加粗
        strong({ children }) {
          return (
            <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {children}
            </strong>
          );
        },
        // 斜体
        em({ children }) {
          return (
            <em style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
              {children}
            </em>
          );
        },
        // 标题
        h1({ children }) {
          return (
            <h1 style={{
              fontSize: "18px", fontWeight: 700, margin: "18px 0 8px",
              color: "var(--text-primary)", lineHeight: "1.4",
              paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}>
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 style={{
              fontSize: "15px", fontWeight: 600, margin: "16px 0 6px",
              color: "var(--text-primary)", lineHeight: "1.4",
            }}>
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 style={{
              fontSize: "14px", fontWeight: 600, margin: "12px 0 4px",
              color: "var(--text-secondary)", lineHeight: "1.4",
            }}>
              {children}
            </h3>
          );
        },
        h4({ children }) {
          return (
            <h4 style={{
              fontSize: "13px", fontWeight: 600, margin: "10px 0 4px",
              color: "var(--text-muted)", lineHeight: "1.4",
            }}>
              {children}
            </h4>
          );
        },
        // 分割线
        hr() {
          return (
            <hr style={{
              border: "none",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              margin: "14px 0",
            }} />
          );
        },
        // 引用块
        blockquote({ children }) {
          return (
            <blockquote style={{
              margin: "8px 0",
              paddingLeft: "12px",
              borderLeft: "3px solid rgba(99,102,241,0.5)",
              color: "var(--text-secondary)",
              fontStyle: "italic",
            }}>
              {children}
            </blockquote>
          );
        },
        // ── GFM 表格 ──
        table({ children }) {
          return (
            <div style={{ overflowX: "auto", margin: "10px 0 14px" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
                lineHeight: "1.6",
              }}>
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return (
            <thead style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
              {children}
            </thead>
          );
        },
        tbody({ children }) {
          return <tbody>{children}</tbody>;
        },
        tr({ children }) {
          return (
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {children}
            </tr>
          );
        },
        th({ children }) {
          return (
            <th style={{
              padding: "8px 12px",
              textAlign: "left",
              fontWeight: 600,
              color: "var(--text-secondary)",
              borderBottom: "1px solid rgba(255,255,255,0.12)",
              whiteSpace: "nowrap",
            }}>
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td style={{
              padding: "7px 12px",
              color: "var(--text-primary)",
              verticalAlign: "top",
            }}>
              {children}
            </td>
          );
        },
        // 链接
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "var(--accent-blue)",
                textDecoration: "none",
                borderBottom: "1px solid rgba(59,130,246,0.3)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderBottomColor = "var(--accent-blue)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderBottomColor = "rgba(59,130,246,0.3)")}
            >
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── 消息元信息栏（Assistant 专属）──
function MessageMeta({ msg }: { msg: ChatMessage }) {
  const { meta, timestamp } = msg;
  const [starred, setStarred] = useState(false);

  const formatTokens = (n?: number) => {
    if (!n) return null;
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginTop: "10px",
        paddingTop: "8px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        flexWrap: "wrap",
      }}
    >
      {/* 收藏星 */}
      <button
        onClick={() => setStarred((v) => !v)}
        title="收藏"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "22px",
          height: "22px",
          borderRadius: "5px",
          border: "none",
          backgroundColor: "transparent",
          color: starred ? "#f59e0b" : "var(--text-muted)",
          cursor: "pointer",
          outline: "none",
          flexShrink: 0,
        }}
      >
        <Star size={13} fill={starred ? "#f59e0b" : "none"} />
      </button>

      {/* 角色 + 时间 */}
      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
        Assistant
      </span>
      <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{timestamp}</span>

      {/* Token 信息 */}
      {meta && (
        <>
          {meta.thinkingSteps && (
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              ↑{meta.thinkingSteps}
            </span>
          )}
          {meta.inputTokens && (
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              ↓{formatTokens(meta.inputTokens)}
            </span>
          )}
          {meta.outputTokens && (
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              R{formatTokens(meta.outputTokens)}
            </span>
          )}
          {meta.wordCount && (
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              W{meta.wordCount}
            </span>
          )}
          {meta.ctxPercent != null && meta.ctxPercent > 0 && (
            <span
              style={{
                fontSize: "12px",
                color:
                  meta.ctxPercent >= 90
                    ? "#ef4444"
                    : meta.ctxPercent >= 70
                    ? "#f59e0b"
                    : "var(--text-muted)",
                fontWeight: meta.ctxPercent >= 70 ? 500 : 400,
              }}
            >
              {meta.ctxPercent}% ctx
            </span>
          )}
          {meta.model && (
            <span
              style={{
                fontSize: "11px",
                color: "var(--accent-blue)",
                backgroundColor: "rgba(59,130,246,0.1)",
                padding: "1px 7px",
                borderRadius: "4px",
                fontFamily: "monospace",
              }}
            >
              {meta.model}
            </span>
          )}
        </>
      )}

      {/* 右侧操作 */}
      <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
        <button
          title="朗读"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "22px", height: "22px", borderRadius: "5px",
            border: "none", backgroundColor: "transparent",
            color: "var(--text-muted)", cursor: "pointer", outline: "none",
          }}
        >
          <Volume2 size={12} />
        </button>
        <button
          title="删除"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "22px", height: "22px", borderRadius: "5px",
            border: "none", backgroundColor: "transparent",
            color: "var(--text-muted)", cursor: "pointer", outline: "none",
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ── 单条消息 ──
function MessageItem({
  msg,
  isStreaming,
  onRetry,
}: {
  msg: ChatMessage;
  isStreaming?: boolean;
  onRetry?: (lang: string, errorMsg: string) => void;
}) {
  const isUser = msg.role === "user";
  // 流程图收起/展开状态（默认展开）
  const [flowExpanded, setFlowExpanded] = useState(true);

  if (isUser) {
    const imagePreviews: string[] = (msg.meta as { imagePreviews?: string[] } | undefined)?.imagePreviews ?? [];
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", padding: "4px 0" }}>
        {/* 图片附件（气泡上方） */}
        {imagePreviews.length > 0 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "72%" }}>
            {imagePreviews.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`附件图片 ${i + 1}`}
                style={{
                  width: 80,
                  height: 80,
                  objectFit: "cover",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.15)",
                  cursor: "pointer",
                }}
                onClick={() => window.open(src, "_blank")}
              />
            ))}
          </div>
        )}
        {/* 文字气泡（无文字时不渲染） */}
        {msg.content && (
          <div
            style={{
              maxWidth: "72%",
              backgroundColor: "var(--accent-blue)",
              color: "#fff",
              padding: "10px 14px",
              borderRadius: "14px 14px 4px 14px",
              fontSize: "14px",
              lineHeight: "1.6",
              wordBreak: "break-word",
            }}
          >
            {msg.content}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{msg.username ?? "You"}</span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{msg.timestamp}</span>
          <div
            style={{
              width: "22px", height: "22px", borderRadius: "50%",
              backgroundColor: "var(--accent-blue)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", color: "#fff", fontWeight: 600, flexShrink: 0,
            }}
          >
            {(msg.username ?? "U")[0].toUpperCase()}
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant 消息 ──
  const hasAgentSteps = msg.agentSteps && msg.agentSteps.length > 0;
  const isThinking = isStreaming && !msg.content && !hasAgentSteps;

  return (
    <div
      style={{
        display: "inline-block",
        maxWidth: hasAgentSteps ? "90%" : "80%",
        width: hasAgentSteps ? "90%" : "fit-content",
        padding: "12px 16px",
        borderRadius: "12px",
        backgroundColor: "var(--card-bg)",
        border: "1px solid var(--border-subtle)",
        margin: "4px 0",
        boxSizing: "border-box",
        wordBreak: "break-word",
        overflowWrap: "break-word",
        verticalAlign: "top",
        position: "relative",
      }}
    >
      {/* 气泡右上角：流程图收起/展开按钮 */}
      {hasAgentSteps && (
        <button
          onClick={() => setFlowExpanded((v) => !v)}
          title={flowExpanded ? "收起执行过程" : "展开执行过程"}
          style={{
            position: "absolute",
            top: "10px",
            right: "12px",
            display: "flex",
            alignItems: "center",
            gap: "3px",
            padding: "2px 7px",
            borderRadius: "5px",
            border: "1px solid var(--border-subtle)",
            backgroundColor: "transparent",
            color: "var(--text-muted)",
            fontSize: "10px",
            cursor: "pointer",
            outline: "none",
            transition: "all 0.15s ease",
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "rgba(255,255,255,0.05)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
          }}
        >
          <GitFork size={10} />
          {flowExpanded
            ? <ChevronDown size={10} />
            : <ChevronRight size={10} />
          }
        </button>
      )}

      {/* Agent 流程图（可收起） */}
      {hasAgentSteps && flowExpanded && (
        <div style={{ paddingRight: hasAgentSteps ? "60px" : "0" }}>
          <AgentFlowChart
            steps={msg.agentSteps!}
            streaming={isStreaming}
          />
        </div>
      )}

      {/* 流程图收起时的精简提示 */}
      {hasAgentSteps && !flowExpanded && (
        <div style={{
          fontSize: "11px",
          color: "var(--text-muted)",
          marginBottom: "8px",
          paddingRight: "60px",
        }}>
          {msg.agentSteps!.length} 个工具调用已完成
        </div>
      )}

      {/* 回复内容 */}
      <div className="md-body" style={{ fontSize: "14px", lineHeight: "1.7" }}>
        {isThinking ? (
          <ThinkingDots />
        ) : (
          <>
            {msg.content && (
              <MarkdownContent
                content={msg.content}
                isStreaming={isStreaming}
                onRetry={onRetry}
              />
            )}
            {hasAgentSteps && !msg.content && isStreaming && <ThinkingDots />}
            {isStreaming && msg.content && <StreamingCursor />}
          </>
        )}
      </div>
      {!isStreaming && <MessageMeta msg={msg} />}
    </div>
  );
}

// ── 思考中三点动画（胶囊形，无外层卡片背景，直接嵌在气泡里） ──
function ThinkingDots() {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "4px 2px",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "var(--text-muted)",
            animation: `dotBounce 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── 流式光标 ──
function StreamingCursor() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "2px",
        height: "1em",
        backgroundColor: "var(--accent-blue)",
        marginLeft: "2px",
        verticalAlign: "text-bottom",
        animation: "blink 1s step-end infinite",
      }}
    />
  );
}

// ── 消息列表主组件 ──
export function MessageList({
  messages,
  streaming,
  onRetry,
}: {
  messages: ChatMessage[];
  streaming?: boolean;
  /** 渲染失败时触发，lang=语言类型，errorMsg=错误信息，由父组件发送修复请求给 Agent */
  onRetry?: (lang: string, errorMsg: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        /* Markdown 表格行 hover */
        table tbody tr:hover {
          background-color: rgba(255,255,255,0.03);
        }
        /* Markdown 首个元素去掉顶部 margin */
        .md-body > *:first-child {
          margin-top: 0 !important;
        }
        .md-body > *:last-child {
          margin-bottom: 0 !important;
        }
      `}</style>
      {messages.map((msg, idx) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          isStreaming={streaming && idx === messages.length - 1 && msg.role === "assistant"}
          onRetry={onRetry}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
