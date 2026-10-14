"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { MessageCircle } from "lucide-react";

export default function MessagesDefaultPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  if (authLoading || !user) return null;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--background)",
        gap: "12px",
      }}
    >
      <MessageCircle
        size={48}
        style={{ color: "var(--text-muted)", opacity: 0.25 }}
      />
      <p style={{ fontSize: "14px", color: "var(--text-muted)", fontWeight: 500 }}>
        选择一个联系人开始聊天
      </p>
      <p style={{ fontSize: "12px", color: "var(--text-muted)", opacity: 0.6 }}>
        或点击左上角 + 添加新联系人
      </p>
    </div>
  );
}
