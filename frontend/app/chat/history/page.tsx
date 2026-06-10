import { History } from "lucide-react";

export default function ChatHistoryPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <History size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        暂无聊天记录
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Chat · 聊天记录
      </p>
    </div>
  );
}
