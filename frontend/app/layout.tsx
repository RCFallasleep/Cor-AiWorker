import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar/sidebar";
import { Topbar } from "@/components/header/topbar";
import { ThemeProvider } from "@/contexts/theme-context";

export const metadata: Metadata = {
  title: "Cor-AiWorker",
  description: "基于多 Agent 协作的团队开发对齐系统",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <ThemeProvider>
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
        </ThemeProvider>
      </body>
    </html>
  );
}
