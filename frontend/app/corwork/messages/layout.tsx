import ConversationList from "@/components/corwork/conversation-list";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* 左侧：联系人/会话列表（常驻） */}
      <ConversationList />

      {/* 右侧：聊天内容区 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
