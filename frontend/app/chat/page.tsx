export default function ChatPage() {
  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "24px",
      }}
    >
      {/* 图标预览区 */}
      <img
        src="/logo.svg"
        alt="Cor-AiWorker Logo"
        style={{ width: "120px", height: "120px" }}
      />

      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: "16px", color: "var(--text-secondary)", marginBottom: "6px" }}>
          Cor-AiWorker
        </p>
        <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          图标预览 · 120×120px
        </p>
      </div>

      {/* 不同尺寸对比 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "32px",
          padding: "20px 32px",
          backgroundColor: "var(--card-bg)",
          borderRadius: "12px",
          border: "1px solid var(--border-color)",
        }}
      >
        {[16, 24, 32, 48, 64].map((size) => (
          <div
            key={size}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}
          >
            <img src="/logo.svg" alt="logo" style={{ width: size, height: size }} />
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{size}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}
