import { FileText } from "lucide-react";

export default function LogsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <FileText size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        Log 日志
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Setting · Agent 执行日志与系统日志
      </p>
    </div>
  );
}
