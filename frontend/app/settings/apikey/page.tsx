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
} from "lucide-react";
import { apiKeyRepo, type ApiKeyRecord, type CreateApiKeyInput, detectProtocol } from "@/lib/repositories/api-key-repository";

// ── 遮码显示 ──
function maskKey(key: string) {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 6) + "••••••••" + key.slice(-4);
}

// ── 协议徽章（自动识别） ──
function ProtocolBadge({ keyValue }: { keyValue: string }) {
  const protocol = detectProtocol(keyValue);
  const isAnthropic = protocol === "anthropic";
  return (
    <span
      style={{
        fontSize: "11px",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "5px",
        backgroundColor: isAnthropic ? "rgba(217,119,6,0.12)" : "rgba(16,163,127,0.12)",
        color: isAnthropic ? "#d97706" : "#10a37f",
        border: `1px solid ${isAnthropic ? "rgba(217,119,6,0.3)" : "rgba(16,163,127,0.3)"}`,
        whiteSpace: "nowrap",
      }}
    >
      {isAnthropic ? "Anthropic" : "OpenAI 兼容"}
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
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // 实时预览协议
  const protocol = detectProtocol(keyValue);
  const isAnthropic = protocol === "anthropic";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim() || !keyValue.trim()) return;
    setSaving(true);
    await onSave({
      // provider 由 key 前缀自动推断，存入数据库
      provider: protocol,
      // label 直接用模型名，不再单独填
      label: modelName.trim(),
      keyValue: keyValue.trim(),
      modelName: modelName.trim(),
      baseUrl: baseUrl.trim() || undefined,
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
            placeholder="如：gpt-4o、deepseek-v4-flash、claude-opus-4-5"
            required
            hint="调用 API 时使用的模型 ID"
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
            {/* 实时协议识别提示 */}
            {keyValue && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <Zap size={10} style={{ color: isAnthropic ? "#d97706" : "#10a37f" }} />
                <span style={{ fontSize: "11px", color: isAnthropic ? "#d97706" : "#10a37f" }}>
                  自动识别为 {isAnthropic ? "Anthropic" : "OpenAI 兼容"} 协议
                </span>
              </div>
            )}
          </div>

          {/* Base URL */}
          <Field
            label="Base URL（可选）"
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="留空使用默认地址，如转发代理填自定义地址"
            hint={isAnthropic ? "Anthropic 默认：https://api.anthropic.com" : "OpenAI 默认：https://api.openai.com/v1"}
          />

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

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "14px 16px",
        backgroundColor: "var(--card-bg)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "10px",
        opacity: record.isActive ? 1 : 0.5,
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

      {/* 协议徽章（自动识别） */}
      <ProtocolBadge keyValue={record.keyValue} />

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
      <div
        style={{
          fontFamily: "monospace", fontSize: "12px",
          color: "var(--text-secondary)", whiteSpace: "nowrap",
          minWidth: "160px",
        }}
      >
        {showKey ? record.keyValue : maskKey(record.keyValue)}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0 }}>
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
