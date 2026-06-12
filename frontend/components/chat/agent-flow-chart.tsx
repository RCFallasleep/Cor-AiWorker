"use client";

/**
 * AgentFlowChart
 * 在 AI 气泡内展示 Agent 工具调用流程图。
 *
 * 布局规则（ReAct 模式）：
 *   - 相同工具的连续调用折叠为一个节点，内部展示每次的 query
 *   - 不同工具之间用箭头连接
 *   - 正在执行的节点有旋转动画，完成的节点显示勾
 */

import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, Search, Globe, FileText, Code2, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentStep } from "@/lib/mock-chat-data";

/** 工具名 → 图标映射 */
function ToolIcon({ name, size = 13 }: { name: string; size?: number }) {
  const s = { size, style: { flexShrink: 0 } };
  if (name === "web_search" || name === "search") return <Search {...s} />;
  if (name === "browse" || name === "fetch_url") return <Globe {...s} />;
  if (name === "read_file" || name === "write_file") return <FileText {...s} />;
  if (name === "run_code" || name === "execute") return <Code2 {...s} />;
  return <Wrench {...s} />;
}

/** 工具名 → 可读标签 */
const TOOL_LABELS: Record<string, string> = {
  web_search:  "联网搜索",
  search:      "搜索",
  browse:      "浏览网页",
  fetch_url:   "读取网页",
  read_file:   "读取文件",
  write_file:  "写入文件",
  run_code:    "执行代码",
  execute:     "执行",
};

function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

/** 折叠后的节点组（同一工具的多次调用） */
interface StepGroup {
  name: string;
  steps: AgentStep[];
  /** 整组状态：有任意 running → running；有任意 error → error；全 done → done */
  status: "running" | "done" | "error";
}

/** 将 steps 按工具名分组（连续相同工具合并，不连续的不合并） */
function groupSteps(steps: AgentStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.name === step.name) {
      last.steps.push(step);
    } else {
      groups.push({ name: step.name, steps: [step], status: step.status });
    }
  }
  // 计算每组的整体状态
  for (const g of groups) {
    if (g.steps.some((s) => s.status === "running")) g.status = "running";
    else if (g.steps.some((s) => s.status === "error")) g.status = "error";
    else g.status = "done";
  }
  return groups;
}

/** 单个折叠节点 */
function StepGroupNode({ group, isLast }: { group: StepGroup; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { name, steps, status } = group;
  const isRunning = status === "running";
  const isDone    = status === "done";
  const isError   = status === "error";
  const count     = steps.length;

  const colors = isRunning
    ? { border: "rgba(59,130,246,0.35)", bg: "rgba(59,130,246,0.06)", icon: "#3b82f6", text: "#60a5fa" }
    : isDone
    ? { border: "rgba(34,197,94,0.35)",  bg: "rgba(34,197,94,0.06)",  icon: "#22c55e", text: "#4ade80" }
    : { border: "rgba(239,68,68,0.35)",  bg: "rgba(239,68,68,0.06)",  icon: "#ef4444", text: "#f87171" };

  // 单次调用时直接展示 query，多次时折叠
  const firstArg = steps[0]?.args["query"] ?? steps[0]?.args["path"] ?? steps[0]?.args["url"];
  const firstArgStr = firstArg != null ? String(firstArg) : null;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0" }}>
      {/* 节点卡片 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          minWidth: "120px",
          maxWidth: count > 1 ? "200px" : "180px",
        }}
      >
        {/* 节点主体 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "8px 10px",
            borderRadius: "8px",
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bg,
            transition: "all 0.2s ease",
            cursor: count > 1 ? "pointer" : "default",
          }}
          onClick={() => count > 1 && setExpanded((v) => !v)}
        >
          {/* 顶行：状态图标 + 工具图标 + 工具名 + 次数徽章 */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            {/* 状态图标 */}
            {isRunning && (
              <Loader2 size={12} style={{ color: colors.icon, flexShrink: 0, animation: "spin 1s linear infinite" }} />
            )}
            {isDone && <CheckCircle2 size={12} style={{ color: colors.icon, flexShrink: 0 }} />}
            {isError && <XCircle size={12} style={{ color: colors.icon, flexShrink: 0 }} />}

            {/* 工具图标 */}
            <span style={{ color: "var(--text-muted)" }}>
              <ToolIcon name={name} size={11} />
            </span>

            {/* 工具名 */}
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}
            >
              {getToolLabel(name)}
            </span>

            {/* 次数徽章（多次调用时显示） */}
            {count > 1 && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  color: colors.text,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "10px",
                  padding: "0 5px",
                  flexShrink: 0,
                  lineHeight: "16px",
                }}
              >
                ×{count}
              </span>
            )}

            {/* 展开/折叠箭头（多次调用时显示） */}
            {count > 1 && (
              <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </span>
            )}
          </div>

          {/* 单次调用：直接展示 query */}
          {count === 1 && firstArgStr && (
            <div
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                paddingLeft: "17px",
              }}
              title={firstArgStr}
            >
              「{firstArgStr.length > 20 ? firstArgStr.slice(0, 20) + "…" : firstArgStr}」
            </div>
          )}

          {/* 多次调用折叠展示：收起时只显示第一条 query */}
          {count > 1 && !expanded && firstArgStr && (
            <div
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                paddingLeft: "17px",
              }}
              title={firstArgStr}
            >
              「{firstArgStr.length > 18 ? firstArgStr.slice(0, 18) + "…" : firstArgStr}」等
            </div>
          )}

          {/* 多次调用展开：列出每次 query */}
          {count > 1 && expanded && (
            <div style={{ paddingLeft: "17px", display: "flex", flexDirection: "column", gap: "3px" }}>
              {steps.map((s, i) => {
                const arg = s.args["query"] ?? s.args["path"] ?? s.args["url"];
                const argStr = arg != null ? String(arg) : "—";
                return (
                  <div
                    key={s.id}
                    style={{
                      fontSize: "10px",
                      color: s.status === "error" ? "#f87171" : "var(--text-muted)",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "4px",
                    }}
                  >
                    <span style={{ flexShrink: 0, opacity: 0.5 }}>{i + 1}.</span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={argStr}
                    >
                      {argStr.length > 22 ? argStr.slice(0, 22) + "…" : argStr}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 状态文字 */}
          <div style={{ fontSize: "10px", color: colors.text, paddingLeft: "17px" }}>
            {isRunning ? "执行中..." : isDone ? "完成" : "失败"}
          </div>
        </div>

        {/* 思考文字（仅单次调用时显示，多次折叠后不显示避免混乱） */}
        {count === 1 && steps[0].thinkingText && (
          <div
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              lineHeight: 1.5,
              padding: "4px 8px",
              borderLeft: "2px solid var(--border-subtle)",
              marginLeft: "4px",
              fontStyle: "italic",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={steps[0].thinkingText}
          >
            {steps[0].thinkingText}
          </div>
        )}
      </div>

      {/* 箭头连接线（最后一个节点不显示） */}
      {!isLast && (
        <div style={{ display: "flex", alignItems: "center", paddingTop: "14px", flexShrink: 0 }}>
          <div style={{ width: "20px", height: "1px", backgroundColor: "var(--border-subtle)" }} />
          <div
            style={{
              width: 0, height: 0,
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              borderLeft: "5px solid var(--border-subtle)",
            }}
          />
        </div>
      )}
    </div>
  );
}

interface AgentFlowChartProps {
  steps: AgentStep[];
  streaming?: boolean;
}

export function AgentFlowChart({ steps, streaming }: AgentFlowChartProps) {
  if (!steps || steps.length === 0) return null;

  const groups = groupSteps(steps);

  return (
    <div
      style={{
        marginBottom: "10px",
        padding: "10px 12px",
        borderRadius: "8px",
        border: "1px solid var(--border-subtle)",
        backgroundColor: "rgba(255,255,255,0.02)",
      }}
    >
      {/* 标题行 */}
      <div
        style={{
          fontSize: "10px",
          color: "var(--text-muted)",
          fontWeight: 500,
          marginBottom: "8px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        执行过程
      </div>

      {/* 横向流程图 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "0",
          overflowX: "auto",
          paddingBottom: "2px",
        }}
      >
        {groups.map((group, idx) => (
          <StepGroupNode
            key={`${group.name}-${idx}`}
            group={group}
            isLast={idx === groups.length - 1}
          />
        ))}

        {/* 流式执行中：最后一个节点已完成，显示"等待下一步"占位 */}
        {streaming && groups.length > 0 && groups[groups.length - 1].status === "done" && (
          <div style={{ display: "flex", alignItems: "center", paddingTop: "14px", flexShrink: 0 }}>
            <div style={{ width: "20px", height: "1px", backgroundColor: "var(--border-subtle)" }} />
            <div style={{
              width: 0, height: 0,
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              borderLeft: "5px solid var(--border-subtle)",
            }} />
            <div style={{
              marginLeft: "8px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "6px 10px",
              borderRadius: "8px",
              border: "1px dashed var(--border-subtle)",
              fontSize: "10px",
              color: "var(--text-muted)",
            }}>
              <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} />
              思考中
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
