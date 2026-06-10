import { Puzzle } from "lucide-react";

export default function SkillsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Puzzle size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Skill / MCP Maker
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        WorkBench · 自建与上传 Skill / MCP 能力
      </p>
    </div>
  );
}
