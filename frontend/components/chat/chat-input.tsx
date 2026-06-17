"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, Plus, Send, Image, FileText, X, Loader2 } from "lucide-react";

interface Attachment {
  id: string;
  name: string;
  type: "image" | "document";
  preview?: string;       // 图片：base64 data URL
  // 文档专属字段（上传解析后填充）
  fileId?: string;        // 后端返回的 file_id
  totalChunks?: number;   // 分块数
  docPreview?: string;    // 文档前 200 字预览
  size?: number;          // 原始文件字节数
  uploading?: boolean;    // 正在上传解析中
  uploadError?: string;   // 上传失败原因
}

interface ChatInputProps {
  onSend: (content: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  supportsVision?: boolean;
  placeholder?: string;
}

const LINE_HEIGHT = 22.4; // 14px * 1.6
const PADDING_V   = 16;   // padding-top 12 + padding-bottom 4
const MIN_HEIGHT  = Math.round(LINE_HEIGHT + PADDING_V);
const MAX_HEIGHT  = Math.round(LINE_HEIGHT * 6 + PADDING_V);

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ChatInput({
  onSend,
  disabled = false,
  supportsVision = true,
  placeholder = "Message Assistant (Enter to send)",
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const textareaRef   = useRef<HTMLTextAreaElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);
  const isComposing   = useRef(false);   // IME 组合输入中（拼音未上屏）

  // 高度随内容动态增长
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${MIN_HEIGHT}px`;
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing=true 时说明拼音还未上屏（IME 组合输入中），不触发发送
    if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    // 有文档还在上传中，不允许发送
    if (attachments.some((a) => a.uploading)) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height    = `${MIN_HEIGHT}px`;
      textareaRef.current.style.overflowY = "hidden";
    }
  }, [text, attachments, onSend]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments((prev) => [
          ...prev,
          { id: `img-${Date.now()}-${Math.random()}`, name: file.name, type: "image", preview: ev.target?.result as string },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
    setShowAttachMenu(false);
  };

  // 文档上传：先占位（uploading=true），再调后端解析接口，成功后填充 fileId
  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      const tempId = `doc-${Date.now()}-${Math.random()}`;
      // 先加入占位附件，显示 loading 状态
      setAttachments((prev) => [
        ...prev,
        { id: tempId, name: file.name, type: "document", size: file.size, uploading: true },
      ]);

      // 调后端解析接口
      if (!BACKEND_URL) {
        // 无后端时降级：仅存文件名（不支持 read_document 工具）
        setAttachments((prev) =>
          prev.map((a) => a.id === tempId ? { ...a, uploading: false } : a)
        );
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      fetch(`${BACKEND_URL}/v1/documents/upload`, { method: "POST", body: formData })
        .then(async (res) => {
          if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "上传失败" }));
            throw new Error(err.detail ?? "上传失败");
          }
          return res.json();
        })
        .then((data: { file_id: string; total_chunks: number; preview: string; size: number }) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? { ...a, uploading: false, fileId: data.file_id, totalChunks: data.total_chunks, docPreview: data.preview, size: data.size }
                : a
            )
          );
        })
        .catch((err: Error) => {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === tempId ? { ...a, uploading: false, uploadError: err.message } : a
            )
          );
        });
    });
    e.target.value = "";
    setShowAttachMenu(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // 粘贴截图：Cmd+Shift+4 / QQ / 微信截图复制后直接 Ctrl+V / Cmd+V
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!supportsVision) return;
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;

    e.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = ev.target?.result as string;
        setAttachments((prev) => [
          ...prev,
          {
            id: `paste-${Date.now()}-${Math.random()}`,
            name: `截图_${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.png`,
            type: "image",
            preview,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  };

  const hasUploading = attachments.some((a) => a.uploading);
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !hasUploading;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: "10px 24px 14px",
        backgroundColor: "var(--background)",
        borderTop: "1px solid var(--border-subtle)",
      }}
    >
      {/* 附件预览区 */}
      {attachments.length > 0 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
          {attachments.map((att) => (
            <div
              key={att.id}
              style={{
                position: "relative", display: "flex", alignItems: "center", gap: "6px",
                padding: att.type === "image" ? "0" : "6px 10px",
                backgroundColor: att.uploadError ? "rgba(239,68,68,0.08)" : "var(--card-bg)",
                border: `1px solid ${att.uploadError ? "rgba(239,68,68,0.3)" : "var(--border-color)"}`,
                borderRadius: "8px", overflow: "hidden",
                maxWidth: "200px",
              }}
            >
              {att.type === "image" && att.preview ? (
                <img src={att.preview} alt={att.name} style={{ width: "56px", height: "56px", objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                  {att.uploading ? (
                    <Loader2 size={14} style={{ color: "var(--accent-blue)", flexShrink: 0, animation: "spin 1s linear infinite" }} />
                  ) : att.uploadError ? (
                    <FileText size={14} style={{ color: "#ef4444", flexShrink: 0 }} />
                  ) : (
                    <FileText size={14} style={{ color: "var(--accent-blue)", flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "12px", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "120px" }}>
                      {att.name}
                    </div>
                    <div style={{ fontSize: "10px", color: att.uploadError ? "#ef4444" : "var(--text-muted)", marginTop: "1px" }}>
                      {att.uploading
                        ? "解析中..."
                        : att.uploadError
                          ? att.uploadError
                          : att.totalChunks
                            ? `${att.totalChunks} 块 · ${formatBytes(att.size ?? 0)}`
                            : formatBytes(att.size ?? 0)
                      }
                    </div>
                  </div>
                </div>
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                style={{
                  position: "absolute", top: "2px", right: "2px",
                  width: "16px", height: "16px", borderRadius: "50%",
                  border: "none", backgroundColor: "rgba(0,0,0,0.6)",
                  color: "#fff", display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer", outline: "none", padding: 0,
                  flexShrink: 0,
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入框主体 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--card-bg)",
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposing.current = true; }}
          onCompositionEnd={() => { isComposing.current = false; }}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          style={{
            width: "100%",
            padding: "12px 14px 4px",
            backgroundColor: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            fontSize: "14px",
            lineHeight: "1.6",
            color: "var(--text-primary)",
            fontFamily: "inherit",
            height: `${MIN_HEIGHT}px`,
            overflowY: "hidden",
            transition: "height 0.12s ease",
            boxSizing: "border-box",
          }}
        />

        {/* 底部操作栏 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "2px", position: "relative" }}>
            <button
              title="添加附件"
              onClick={() => setShowAttachMenu((v) => !v)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "30px", height: "30px", borderRadius: "7px",
                border: "none", backgroundColor: "transparent",
                color: "var(--text-secondary)", cursor: "pointer", outline: "none",
              }}
            >
              <Paperclip size={15} />
            </button>

            {showAttachMenu && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setShowAttachMenu(false)} />
                <div
                  style={{
                    position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 20,
                    backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)",
                    borderRadius: "10px", padding: "4px",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: "160px",
                  }}
                >
                  {supportsVision && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        width: "100%", padding: "8px 10px", borderRadius: "7px",
                        border: "none", backgroundColor: "transparent",
                        color: "var(--text-primary)", fontSize: "13px",
                        cursor: "pointer", outline: "none", textAlign: "left",
                      }}
                    >
                      <Image size={14} style={{ color: "var(--text-secondary)" }} />
                      上传图片
                    </button>
                  )}
                  <button
                    onClick={() => docInputRef.current?.click()}
                    style={{
                      display: "flex", alignItems: "center", gap: "8px",
                      width: "100%", padding: "8px 10px", borderRadius: "7px",
                      border: "none", backgroundColor: "transparent",
                      color: "var(--text-primary)", fontSize: "13px",
                      cursor: "pointer", outline: "none", textAlign: "left",
                    }}
                  >
                    <FileText size={14} style={{ color: "var(--text-secondary)" }} />
                    上传文档
                  </button>
                </div>
              </>
            )}

            <button
              title="更多功能 (MCP / Skill)"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "30px", height: "30px", borderRadius: "7px",
                border: "none", backgroundColor: "transparent",
                color: "var(--text-secondary)", cursor: "pointer", outline: "none",
              }}
            >
              <Plus size={15} />
            </button>
          </div>

          <button
            onClick={handleSend}
            disabled={!canSend}
            title={hasUploading ? "文档解析中，请稍候..." : "发送 (Enter)"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "30px", height: "30px", borderRadius: "7px",
              border: "none",
              backgroundColor: canSend ? "var(--accent-blue)" : "var(--border-color)",
              color: canSend ? "#fff" : "var(--text-muted)",
              cursor: canSend ? "pointer" : "not-allowed",
              outline: "none",
              transition: "background-color 0.15s ease",
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleImageUpload} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.txt,.md" multiple style={{ display: "none" }} onChange={handleDocUpload} />
    </div>
  );
}
