import { LayoutDashboard } from "lucide-react";

export default function BoardPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "12px",
      }}
    >
      <LayoutDashboard size={40} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
      <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>协作看板</p>
      <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
        即将上线 · 敬请期待
      </p>
    </div>
  );
}
