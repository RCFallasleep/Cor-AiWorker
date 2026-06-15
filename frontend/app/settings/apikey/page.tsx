"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  Key,
  Zap,
  FlaskConical,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { apiKeyRepo, type ApiKeyRecord, type CreateApiKeyInput, type ProviderType, detectProtocol } from "@/lib/repositories/api-key-repository";

/** 后端地址（与 use-chat-stream 保持一致） */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

/**
 * 测试一条 API Key 是否可用：发送 "Hi" 并等待第一个 delta 事件。
 * 返回 { ok: true } 或 { ok: false, error: string }
 */
async function testApiKey(record: ApiKeyRecord): Promise<{ ok: boolean; error?: string }> {
  const body = BACKEND_URL
    ? JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: record.modelName || record.label,
        api_key: record.keyValue,
        base_url: record.baseUrl ?? null,
        extra_headers: record.extraHeaders ?? null,
        provider: record.provider,
      })
    : JSON.stringify({
        messages: [{ role: "user", content: "Hi" }],
        model: record.modelName || record.label,
        apiKey: record.keyValue,
        baseUrl: record.baseUrl,
        extraHeaders: record.extraHeaders,
        provider: record.provider,
      });

  const endpoint = BACKEND_URL ? `${BACKEND_URL}/v1/chat` : "/api/chat";

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? data.detail ?? `HTTP ${res.status}` };
    }

    // 读取流，只要收到第一个 delta 就算成功
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, error: "无法读取响应流" };
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "delta" && event.content) {
            reader.cancel();
            return { ok: true };
          }
          if (event.type === "error") {
            reader.cancel();
            return { ok: false, error: event.message };
          }
          if (event.type === "done") {
            return { ok: true }; // 有些模型回复很短，直接 done 也算成功
          }
        } catch { /* 忽略解析失败 */ }
      }
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "请求失败";
    return { ok: false, error: msg };
  }
}

// ── 遮码显示 ──
function maskKey(key: string) {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 6) + "••••••••" + key.slice(-4);
}

// ── 协议徽章（显示实际存储的 provider）──
const PROVIDER_BADGE: Record<ProviderType, { label: string; bg: string; color: string; border: string }> = {
  openai:    { label: "OpenAI 兼容", bg: "rgba(16,163,127,0.12)",  color: "#10a37f", border: "rgba(16,163,127,0.3)"  },
  anthropic: { label: "Anthropic",   bg: "rgba(217,119,6,0.12)",   color: "#d97706", border: "rgba(217,119,6,0.3)"   },
  bedrock:   { label: "Bedrock",     bg: "rgba(139,92,246,0.12)",  color: "#8b5cf6", border: "rgba(139,92,246,0.3)"  },
  vertex:    { label: "Vertex AI",   bg: "rgba(59,130,246,0.12)",  color: "#3b82f6", border: "rgba(59,130,246,0.3)"  },
};

function ProtocolBadge({ provider }: { provider: ProviderType }) {
  const badge = PROVIDER_BADGE[provider] ?? PROVIDER_BADGE.openai;
  return (
    <span style={{
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "5px",
      backgroundColor: badge.bg, color: badge.color,
      border: `1px solid ${badge.border}`, whiteSpace: "nowrap",
    }}>
      {badge.label}
    </span>
  );
}

// ── 输入框 ──
function Field({
  label, value, onChange, placeholder, type = "text", required, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: "2px" }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "8px 10px",
          backgroundColor: "var(--background)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          color: "var(--text-primary)",
          fontSize: "13px",
          outline: "none",
          fontFamily: type === "password" ? "monospace" : "inherit",
        }}
      />
      {hint && (
        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{hint}</span>
      )}
    </div>
  );
}

// ── 新增 / 编辑 表单弹窗 ──
function KeyFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: ApiKeyRecord;
  onSave: (data: CreateApiKeyInput) => Promise<void>;
  onClose: () => void;
}) {
  const [modelName, setModelName] = useState(initial?.modelName ?? "");
  const [keyValue, setKeyValue] = useState(initial?.keyValue ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  // extraHeaders 以 "Key: Value" 每行一条的文本形式编辑
  const [extraHeadersText, setExtraHeadersText] = useState(() => {
    const h = initial?.extraHeaders;
    if (!h) return "";
    return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n");
  });
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // 协议：由 key 前缀自动推断，可手动覆盖（支持 openai / anthropic / bedrock）
  const autoProtocol = detectProtocol(keyValue);  // 只能推断 openai / anthropic
  const [protocolOverride, setProtocolOverride] = useState<ProviderType | null>(() => {
    if (!initial) return null;
    // 编辑模式：若存储的 provider 与当前 key 自动识别结果不同，说明是手动设置过的，保留
    const auto = detectProtocol(initial.keyValue);
    return initial.provider !== auto ? initial.provider : null;
  });
  // 最终生效的协议：手动覆盖 > 自动识别
  const protocol: ProviderType = protocolOverride ?? autoProtocol;
  const isAnthropic = protocol === "anthropic";
  const isBedrock = protocol === "bedrock";
  const isVertex = protocol === "vertex";
  // MaaS 网关识别（base_url 含 maas 关键字）
  const isMaaS = baseUrl.toLowerCase().includes("maas");

  /** 将多行文本解析为 Header 对象，忽略格式错误的行 */
  function parseExtraHeaders(text: string): Record<string, string> | undefined {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return undefined;
    const result: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx < 1) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) result[k] = v;
    }
    return Object.keys(result).length ? result : undefined;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || !keyValue.trim()) return;
    setSaving(true);
    await onSave({
      // provider：手动覆盖 > 自动识别
      provider: protocol,
      // label 直接用模型名，不再单独填
      label: modelName.trim(),
      keyValue: keyValue.trim(),
      modelName: modelName.trim(),
      baseUrl: baseUrl.trim() || undefined,
      extraHeaders: parseExtraHeaders(extraHeadersText),
      isActive: initial?.isActive ?? true,
    });
    setSaving(false);
  };

  const canSubmit = modelName.trim() && keyValue.trim();

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "14px",
          padding: "24px",
          width: "100%",
          maxWidth: "420px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
            {initial ? "编辑 API Key" : "新增 API Key"}
          </h2>
          <button
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "7px",
              border: "none", backgroundColor: "transparent",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* 模型名 */}
          <Field
            label="模型名"
            value={modelName}
            onChange={setModelName}
            placeholder={isMaaS ? "如：deepseek-v4-flash、claude-sonnet-4-5" : "如：gpt-4o、deepseek-v4-flash、claude-opus-4-5"}
            required
            hint={isMaaS ? "企业网关模型 ID，填写平台提供的模型名" : "调用 API 时使用的模型 ID"}
          />

          {/* API Key */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
              API Key <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showKey ? "text" : "password"}
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder="sk-...  或  sk-ant-..."
                style={{
                  width: "100%", padding: "8px 36px 8px 10px",
                  backgroundColor: "var(--background)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px", color: "var(--text-primary)",
                  fontSize: "13px", outline: "none",
                  fontFamily: "monospace", boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                style={{
                  position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "22px", height: "22px", border: "none",
                  backgroundColor: "transparent", color: "var(--text-secondary)",
                  cursor: "pointer", outline: "none",
                }}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            {/* 协议选择：自动识别 + 可手动覆盖 */}
            {keyValue && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <Zap size={10} style={{ color: isVertex ? "#3b82f6" : isBedrock ? "#8b5cf6" : isAnthropic ? "#d97706" : "#10a37f" }} />
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {protocolOverride ? "已手动指定：" : "自动识别："}
                </span>
                {/* OpenAI 兼容 */}
                <button type="button" onClick={() => setProtocolOverride("openai")} style={{
                  padding: "1px 7px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", outline: "none",
                  border: `1px solid ${protocol === "openai" ? "rgba(16,163,127,0.5)" : "var(--border-color)"}`,
                  backgroundColor: protocol === "openai" ? "rgba(16,163,127,0.12)" : "transparent",
                  color: protocol === "openai" ? "#10a37f" : "var(--text-muted)",
                  fontWeight: protocol === "openai" ? 600 : 400,
                }}>OpenAI 兼容</button>
                {/* Anthropic */}
                <button type="button" onClick={() => setProtocolOverride("anthropic")} style={{
                  padding: "1px 7px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", outline: "none",
                  border: `1px solid ${protocol === "anthropic" ? "rgba(217,119,6,0.5)" : "var(--border-color)"}`,
                  backgroundColor: protocol === "anthropic" ? "rgba(217,119,6,0.12)" : "transparent",
                  color: protocol === "anthropic" ? "#d97706" : "var(--text-muted)",
                  fontWeight: protocol === "anthropic" ? 600 : 400,
                }}>Anthropic</button>
                {/* Bedrock */}
                <button type="button" onClick={() => setProtocolOverride("bedrock")} style={{
                  padding: "1px 7px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", outline: "none",
                  border: `1px solid ${protocol === "bedrock" ? "rgba(139,92,246,0.5)" : "var(--border-color)"}`,
                  backgroundColor: protocol === "bedrock" ? "rgba(139,92,246,0.12)" : "transparent",
                  color: protocol === "bedrock" ? "#8b5cf6" : "var(--text-muted)",
                  fontWeight: protocol === "bedrock" ? 600 : 400,
                }}>Bedrock</button>
                {/* Vertex AI */}
                <button type="button" onClick={() => setProtocolOverride("vertex")} style={{
                  padding: "1px 7px", borderRadius: "4px", fontSize: "11px", cursor: "pointer", outline: "none",
                  border: `1px solid ${protocol === "vertex" ? "rgba(59,130,246,0.5)" : "var(--border-color)"}`,
                  backgroundColor: protocol === "vertex" ? "rgba(59,130,246,0.12)" : "transparent",
                  color: protocol === "vertex" ? "#3b82f6" : "var(--text-muted)",
                  fontWeight: protocol === "vertex" ? 600 : 400,
                }}>Vertex AI</button>
                {/* 重置 */}
                {protocolOverride && (
                  <button type="button" onClick={() => setProtocolOverride(null)} style={{
                    padding: "1px 5px", borderRadius: "4px", fontSize: "10px", cursor: "pointer", outline: "none",
                    border: "1px solid var(--border-color)", backgroundColor: "transparent", color: "var(--text-muted)",
                  }}>重置</button>
                )}
              </div>
            )}
          </div>

          {/* Base URL */}
          <Field
            label={(isBedrock || isVertex) ? "Base URL（必填）" : "Base URL（可选）"}
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder={
              isBedrock
                ? "如：https://your-gateway.example.com/bedrock_runtime/model/invoke-with-response-stream"
                : isVertex
                  ? "如：https://your-gateway.example.com/google/anthropic/v1:streamRawPredict"
                  : "留空使用默认地址，如转发代理填自定义地址"
            }
            hint={
              isBedrock
                ? "Bedrock 网关完整 URL（含路径），认证信息填在下方额外 Header 里"
                : isVertex
                  ? "Vertex AI 网关完整 URL（含 v1:streamRawPredict），认证信息填在下方额外 Header 里"
                  : isAnthropic
                    ? "Anthropic 默认：https://api.anthropic.com"
                    : "OpenAI 默认：https://api.openai.com/v1"
            }
          />

          {/* MaaS 快速填充提示 */}
          {isMaaS && !extraHeadersText && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: "8px",
              padding: "10px 12px", borderRadius: "8px",
              backgroundColor: "rgba(59,130,246,0.07)",
              border: "1px solid rgba(59,130,246,0.25)",
            }}>
              <span style={{ fontSize: "12px", color: "var(--accent-blue)", lineHeight: 1.5 }}>
                检测到企业网关，可能需要额外 Header 认证。
              </span>
              <button
                type="button"
                onClick={() => setExtraHeadersText(
                  `x-custom-header: your-value\nx-app-id: your-app-id`
                )}
                style={{
                  flexShrink: 0, padding: "2px 8px", borderRadius: "5px",
                  border: "1px solid rgba(59,130,246,0.4)",
                  backgroundColor: "rgba(59,130,246,0.12)",
                  color: "var(--accent-blue)", fontSize: "11px",
                  cursor: "pointer", outline: "none", whiteSpace: "nowrap",
                }}
              >
                快速填充
              </button>
            </div>
          )}

          {/* Extra Headers */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
              额外 Header（可选）
            </label>
            <textarea
              value={extraHeadersText}
              onChange={(e) => setExtraHeadersText(e.target.value)}
              placeholder={"每行一条，格式：Key: Value\n例：x-custom-header: your-value\n    x-app-id: your-app-id"}
              rows={3}
              style={{
                padding: "8px 10px",
                backgroundColor: "var(--background)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "12px",
                outline: "none",
                fontFamily: "monospace",
                resize: "vertical",
                lineHeight: 1.6,
              }}
            />
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              用于 MaaS / 企业网关等需要自定义 Header 认证的场景
            </span>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, padding: "9px",
                backgroundColor: "transparent",
                border: "1px solid var(--border-color)",
                borderRadius: "8px", color: "var(--text-secondary)",
                fontSize: "13px", cursor: "pointer", outline: "none",
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || !canSubmit}
              style={{
                flex: 1, padding: "9px",
                backgroundColor: "var(--accent-blue)",
                border: "none", borderRadius: "8px",
                color: "#fff", fontSize: "13px",
                cursor: saving || !canSubmit ? "not-allowed" : "pointer",
                outline: "none",
                opacity: saving || !canSubmit ? 0.6 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}
            >
              {saving ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={13} />}
              {initial ? "保存" : "添加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Key 列表项 ──
type TestStatus = "idle" | "testing" | "ok" | "fail";

function KeyRow({
  record,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  record: ApiKeyRecord;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete();
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestError(null);
    const result = await testApiKey(record);
    if (result.ok) {
      setTestStatus("ok");
      // 3 秒后自动恢复 idle
      setTimeout(() => setTestStatus("idle"), 3000);
    } else {
      setTestStatus("fail");
      setTestError(result.error ?? "未知错误");
    }
  };

  // 测试按钮的颜色和图标
  const testIcon =
    testStatus === "testing" ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> :
    testStatus === "ok"      ? <CheckCircle2 size={13} /> :
    testStatus === "fail"    ? <XCircle size={13} /> :
                               <FlaskConical size={13} />;
  const testColor =
    testStatus === "ok"   ? "#10a37f" :
    testStatus === "fail" ? "#ef4444" :
    "var(--text-secondary)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 16px",
          backgroundColor: "var(--card-bg)",
          border: `1px solid ${testStatus === "ok" ? "rgba(16,163,127,0.3)" : testStatus === "fail" ? "rgba(239,68,68,0.3)" : "var(--border-subtle)"}`,
          borderRadius: testError ? "10px 10px 0 0" : "10px",
          opacity: record.isActive ? 1 : 0.5,
          transition: "border-color 0.2s",
        }}
      >
        {/* 激活状态点 */}
        <div
          onClick={onToggleActive}
          title={record.isActive ? "点击禁用" : "点击启用"}
          style={{
            width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0,
            backgroundColor: record.isActive ? "var(--online-green)" : "var(--text-muted)",
            cursor: "pointer",
          }}
        />

        {/* 协议徽章（显示实际存储的 provider） */}
        <ProtocolBadge provider={record.provider} />

        {/* 模型名 + Base URL */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", marginBottom: "2px" }}>
            <span style={{ fontFamily: "monospace" }}>{record.modelName || record.label}</span>
          </div>
          {record.baseUrl && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
              {record.baseUrl}
            </span>
          )}
        </div>

        {/* Key 值 */}
        <div style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap", minWidth: "160px" }}>
          {showKey ? record.keyValue : maskKey(record.keyValue)}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
          {/* 测试按钮 */}
          <button
            onClick={handleTest}
            disabled={testStatus === "testing"}
            title={
              testStatus === "ok"   ? "连通性正常" :
              testStatus === "fail" ? `测试失败：${testError}` :
              "测试连通性"
            }
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: testColor,
              cursor: testStatus === "testing" ? "not-allowed" : "pointer", outline: "none",
              transition: "color 0.2s",
            }}
          >
            {testIcon}
          </button>
          <button
            onClick={() => setShowKey((v) => !v)}
            title={showKey ? "隐藏 Key" : "显示 Key"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            onClick={onEdit}
            title="编辑"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: "var(--text-secondary)", cursor: "pointer", outline: "none",
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="删除"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "28px", height: "28px", borderRadius: "6px",
              border: "none", backgroundColor: "transparent",
              color: deleting ? "var(--text-muted)" : "#ef4444",
              cursor: deleting ? "not-allowed" : "pointer", outline: "none",
            }}
          >
            {deleting ? <Loader2 size={13} /> : <Trash2 size={13} />}
          </button>
        </div>
      </div>

      {/* 测试失败时展开错误详情 */}
      {testStatus === "fail" && testError && (
        <div style={{
          padding: "8px 16px",
          backgroundColor: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.3)",
          borderTop: "none",
          borderRadius: "0 0 10px 10px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
        }}>
          <span style={{ fontSize: "11px", color: "#ef4444", wordBreak: "break-all" }}>
            {testError}
          </span>
          <button
            onClick={() => { setTestStatus("idle"); setTestError(null); }}
            style={{
              flexShrink: 0, padding: "1px 6px", borderRadius: "4px", fontSize: "10px",
              border: "1px solid rgba(239,68,68,0.3)", backgroundColor: "transparent",
              color: "#ef4444", cursor: "pointer", outline: "none",
            }}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

// ── 主页面 ──
export default function ApiKeyPage() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiKeyRecord | undefined>();

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const all = await apiKeyRepo.getAll();
    setKeys(all);
    setLoading(false);
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleSave = async (data: CreateApiKeyInput) => {
    if (editTarget) {
      await apiKeyRepo.update(editTarget.id, data);
    } else {
      await apiKeyRepo.create(data);
    }
    setShowModal(false);
    setEditTarget(undefined);
    await loadKeys();
  };

  const handleDelete = async (id: string) => {
    await apiKeyRepo.delete(id);
    await loadKeys();
  };

  const handleToggleActive = async (record: ApiKeyRecord) => {
    await apiKeyRepo.update(record.id, { isActive: !record.isActive });
    await loadKeys();
  };

  const openAdd = () => { setEditTarget(undefined); setShowModal(true); };
  const openEdit = (r: ApiKeyRecord) => { setEditTarget(r); setShowModal(true); };

  return (
    <div style={{ padding: "28px 28px", height: "100%", overflowY: "auto", boxSizing: "border-box" }}>
      {/* 页头 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 4px" }}>
            API Key 管理
          </h1>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
            填入模型名 + API Key 即可使用，协议自动识别，Key 仅存储在本地
          </p>
        </div>
        <button
          onClick={openAdd}
          style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 14px",
            backgroundColor: "var(--accent-blue)",
            border: "none", borderRadius: "8px",
            color: "#fff", fontSize: "13px", fontWeight: 500,
            cursor: "pointer", outline: "none", flexShrink: 0,
          }}
        >
          <Plus size={14} />
          新增 Key
        </button>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px", gap: "8px", color: "var(--text-muted)" }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          <span style={{ fontSize: "13px" }}>加载中...</span>
        </div>
      ) : keys.length === 0 ? (
        <div
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            height: "260px", gap: "12px",
            border: "1px dashed var(--border-color)", borderRadius: "12px",
          }}
        >
          <Key size={36} style={{ color: "var(--text-muted)" }} />
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>还没有 API Key</p>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>填入模型名 + API Key 即可开始对话</p>
          <button
            onClick={openAdd}
            style={{
              marginTop: "4px", padding: "8px 16px",
              backgroundColor: "transparent",
              border: "1px solid var(--border-color)",
              borderRadius: "8px", color: "var(--text-secondary)",
              fontSize: "13px", cursor: "pointer", outline: "none",
            }}
          >
            + 新增 Key
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {keys.map((record) => (
            <KeyRow
              key={record.id}
              record={record}
              onEdit={() => openEdit(record)}
              onDelete={() => handleDelete(record.id)}
              onToggleActive={() => handleToggleActive(record)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <KeyFormModal
          initial={editTarget}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditTarget(undefined); }}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
