import { Timer } from "lucide-react";

export default function SchedulePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Timer size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        定时任务
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        WorkBench · 配置定时触发的 Agent 任务
      </p>
    </div>
  );
}
