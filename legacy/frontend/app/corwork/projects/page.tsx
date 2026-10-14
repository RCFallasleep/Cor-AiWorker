import { FolderKanban } from "lucide-react";

export default function ProjectsPage() {
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
      <FolderKanban size={40} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} />
      <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>项目</p>
      <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
        新建项目，查看各 Agent 对齐进度与审查状态
      </p>
    </div>
  );
}
