import { Users } from "lucide-react";

export default function CorWorkPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Users size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        协作交流
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        CorWork · 需求对齐与多 Agent 协作
      </p>
    </div>
  );
}
