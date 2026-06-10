import { Key } from "lucide-react";

export default function ApiKeyPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Key size={40} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        API Key 管理
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Setting · 管理各模型服务的 API Key
      </p>
    </div>
  );
}
