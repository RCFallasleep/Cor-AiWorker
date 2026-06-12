"use client";

import { BrainCircuit, Plus, ChevronRight, Zap, Users, GitBranch } from "lucide-react";
import { useState } from "react";

// 示例 Agent 角色卡片数据
const AGENT_ROLES = [
  {
    id: "analyst",
    name: "需求分析师",
    desc: "拆解目标，梳理需求边界，输出结构化分析报告",
    color: "#4f8ef7",
    icon: "🔍",
  },
  {
    id: "architect",
    name: "系统架构师",
    desc: "评估技术方案，设计系统结构，识别潜在风险",
    color: "#a78bfa",
    icon: "🏗️",
  },
  {
    id: "critic",
    name: "批判性审查员",
    desc: "挑战假设，发现盲点，提出反驳意见",
    color: "#f97316",
    icon: "⚡",
  },
  {
    id: "executor",
    name: "执行规划师",
    desc: "制定行动计划，分解任务，评估优先级",
    color: "#22c55e",
    icon: "📋",
  },
];

export default function ThinkTankPage() {
  const [selectedAgents, setSelectedAgents] = useState<string[]>(["analyst", "architect"]);
  const [topic, setTopic] = useState("");
  const [started, setStarted] = useState(false);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--bg-primary)",
        overflow: "hidden",
      }}
    >
      {/* 顶部标题栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "20px 28px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <BrainCircuit size={20} style={{ color: "var(--accent-blue)" }} />
        <div>
          <h1 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            Agent-Nest
          </h1>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0, marginTop: "2px" }}>
            一人主导 · 多 Agent 协作推演
          </p>
        </div>
      </div>

      {/* 主体内容 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        {/* 说明卡片 */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            padding: "16px",
            borderRadius: "12px",
            backgroundColor: "var(--bg-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {[
            { icon: <Users size={16} />, title: "组建团队", desc: "选择参与协作的 Agent 角色" },
            { icon: <GitBranch size={16} />, title: "提出议题", desc: "输入你想推演的问题或决策" },
            { icon: <Zap size={16} />, title: "并行推演", desc: "各 Agent 从不同视角给出分析" },
          ].map((step, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "12px",
                borderRadius: "8px",
                backgroundColor: "var(--bg-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--accent-blue)" }}>
                {step.icon}
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
                  {step.title}
                </span>
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0 }}>{step.desc}</p>
            </div>
          ))}
        </div>

        {/* Agent 角色选择 */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <h2 style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", margin: 0 }}>
              选择 Agent 角色
            </h2>
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              已选 {selectedAgents.length} / {AGENT_ROLES.length}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "10px",
            }}
          >
            {AGENT_ROLES.map((agent) => {
              const isSelected = selectedAgents.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  onClick={() => toggleAgent(agent.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "14px",
                    borderRadius: "10px",
                    border: `1px solid ${isSelected ? agent.color + "60" : "var(--border-subtle)"}`,
                    backgroundColor: isSelected ? agent.color + "12" : "var(--bg-secondary)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                    outline: "none",
                  }}
                >
                  <span style={{ fontSize: "22px", lineHeight: 1, flexShrink: 0 }}>{agent.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: isSelected ? agent.color : "var(--text-primary)",
                        }}
                      >
                        {agent.name}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            backgroundColor: agent.color,
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        margin: 0,
                        lineHeight: 1.5,
                      }}
                    >
                      {agent.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 议题输入 */}
        <div>
          <h2
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--text-secondary)",
              margin: 0,
              marginBottom: "12px",
            }}
          >
            输入议题
          </h2>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="描述你想让智囊团推演的问题、决策或方案…&#10;&#10;例如：我们是否应该将现有的单体架构拆分为微服务？"
            rows={4}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-secondary)",
              color: "var(--text-primary)",
              fontSize: "13px",
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--accent-blue)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
            }}
          />
        </div>

        {/* 启动按钮 */}
        <button
          disabled={selectedAgents.length === 0 || !topic.trim()}
          onClick={() => setStarted(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "12px 24px",
            borderRadius: "10px",
            border: "none",
            backgroundColor:
              selectedAgents.length === 0 || !topic.trim()
                ? "var(--bg-secondary)"
                : "var(--accent-blue)",
            color:
              selectedAgents.length === 0 || !topic.trim()
                ? "var(--text-muted)"
                : "#fff",
            fontSize: "14px",
            fontWeight: 600,
            cursor:
              selectedAgents.length === 0 || !topic.trim() ? "not-allowed" : "pointer",
            transition: "all 0.15s ease",
            outline: "none",
          }}
        >
          <Zap size={16} />
          启动智囊团推演
          <ChevronRight size={16} />
        </button>

        {/* 占位提示（功能开发中） */}
        {started && (
          <div
            style={{
              padding: "20px",
              borderRadius: "12px",
              border: "1px dashed var(--border-subtle)",
              backgroundColor: "var(--bg-secondary)",
              textAlign: "center",
            }}
          >
            <BrainCircuit size={28} style={{ color: "var(--accent-blue)", margin: "0 auto 10px" }} />
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>
              智囊团推演功能正在建设中
            </p>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "6px 0 0" }}>
              已选 {selectedAgents.length} 个 Agent · 议题已记录
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
