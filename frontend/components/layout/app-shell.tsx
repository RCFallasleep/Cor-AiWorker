"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Topbar } from "@/components/header/topbar";
import { CorworkSidebar } from "@/components/corwork/corwork-sidebar";

// 这些路径不需要主 Shell（侧边栏 + Topbar）
const FULLSCREEN_PATHS = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullscreen = FULLSCREEN_PATHS.some((p) => pathname.startsWith(p));

  if (isFullscreen) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        minWidth: "600px",
        backgroundColor: "var(--background)",
      }}
    >
      <Sidebar />
      <CorworkSidebar />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        <Topbar />
        <main
          style={{
            flex: 1,
            overflow: "auto",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
