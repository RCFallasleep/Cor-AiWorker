import { Moon } from "lucide-react";

export default function DreamsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Moon size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        梦境归档
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Health · 实验功能
      </p>
    </div>
  );
}
