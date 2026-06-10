import { LayoutDashboard } from "lucide-react";

export default function BoardPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <LayoutDashboard size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        协作看板
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        WorkBench · 进度 / API 用量 / 日程 / 定时任务
      </p>
    </div>
  );
}
