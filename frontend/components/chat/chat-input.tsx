"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, Plus, Send, Image, FileText, X } from "lucide-react";

interface Attachment {
  id: string;
  name: string;
  type: "image" | "document";
  preview?: string;
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

export function ChatInput({
  onSend,
  disabled = false,
  supportsVision = true,
  placeholder = "Message Assistant (Enter to send)",
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef  = useRef<HTMLInputElement>(null);

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
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

  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      setAttachments((prev) => [
        ...prev,
        { id: `doc-${Date.now()}-${Math.random()}`, name: file.name, type: "document" },
      ]);
    });
    e.target.value = "";
    setShowAttachMenu(false);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled;

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
                backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)",
                borderRadius: "8px", overflow: "hidden",
              }}
            >
              {att.type === "image" && att.preview ? (
                <img src={att.preview} alt={att.name} style={{ width: "56px", height: "56px", objectFit: "cover", display: "block" }} />
              ) : (
                <>
                  <FileText size={14} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {att.name}
                  </span>
                </>
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                style={{
                  position: "absolute", top: "2px", right: "2px",
                  width: "16px", height: "16px", borderRadius: "50%",
                  border: "none", backgroundColor: "rgba(0,0,0,0.6)",
                  color: "#fff", display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer", outline: "none", padding: 0,
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入框主体（撑满宽度） */}
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
            title="发送 (Enter)"
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
