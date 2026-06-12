"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Star, Volume2, Trash2, GitFork, ChevronDown, ChevronRight } from "lucide-react";
import type { ChatMessage } from "@/lib/mock-chat-data";
import { AgentFlowChart } from "@/components/chat/agent-flow-chart";

// ── 代码块组件（含语言标签 + 复制按钮）──
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
          justifyContent: "space-between",
          padding: "6px 14px",
          backgroundColor: "rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "monospace" }}>
          {language || "code"}
        </span>
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

      {/* 代码内容 */}
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
    </div>
  );
}

// ── Markdown 渲染器 ──
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        // 代码块
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isBlock = match !== null;
          const codeStr = String(children).replace(/\n$/, "");

          if (isBlock) {
            return <CodeBlock language={match[1]} code={codeStr} />;
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
            <p style={{ margin: "6px 0", lineHeight: "1.7", color: "var(--text-primary)" }}>
              {children}
            </p>
          );
        },
        // 有序列表
        ol({ children }) {
          return (
            <ol style={{ margin: "8px 0", paddingLeft: "20px", lineHeight: "1.8" }}>
              {children}
            </ol>
          );
        },
        // 无序列表
        ul({ children }) {
          return (
            <ul style={{ margin: "8px 0", paddingLeft: "20px", lineHeight: "1.8" }}>
              {children}
            </ul>
          );
        },
        li({ children }) {
          return (
            <li style={{ color: "var(--text-primary)", marginBottom: "2px" }}>
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
        // 标题
        h1({ children }) {
          return <h1 style={{ fontSize: "18px", fontWeight: 600, margin: "12px 0 6px", color: "var(--text-primary)" }}>{children}</h1>;
        },
        h2({ children }) {
          return <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "10px 0 5px", color: "var(--text-primary)" }}>{children}</h2>;
        },
        h3({ children }) {
          return <h3 style={{ fontSize: "14px", fontWeight: 600, margin: "8px 0 4px", color: "var(--text-primary)" }}>{children}</h3>;
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
          {meta.ctxPercent && (
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
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
function MessageItem({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  const isUser = msg.role === "user";
  // 流程图收起/展开状态（默认展开）
  const [flowExpanded, setFlowExpanded] = useState(true);

  if (isUser) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", padding: "4px 0" }}>
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
      <div style={{ fontSize: "14px", lineHeight: "1.7" }}>
        {isThinking ? (
          <ThinkingDots />
        ) : (
          <>
            {msg.content && <MarkdownContent content={msg.content} />}
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
export function MessageList({ messages, streaming }: { messages: ChatMessage[]; streaming?: boolean }) {
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
      `}</style>
      {messages.map((msg, idx) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          isStreaming={streaming && idx === messages.length - 1 && msg.role === "assistant"}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
