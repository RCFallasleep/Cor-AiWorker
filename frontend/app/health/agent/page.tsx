import { Sparkles } from "lucide-react";

export default function AgentPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Sparkles size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Agent 养成
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Health · 等级 / 梦境系统（实验功能）
      </p>
    </div>
  );
}
