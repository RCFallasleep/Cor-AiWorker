"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Puzzle,
  Plus,
  Search,
  X,
  Code2,
  FileText,
  Zap,
  Users,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Eye,
  Upload,
  Check,
  AlertCircle,
  Loader2,
  ChevronRight,
  FolderOpen,
} from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface SkillFile {
  id: string;
  skill_id: string;
  filename: string;
  content: string;
  language: string;
  created_at: string;
  updated_at: string;
}

interface SkillComposition {
  language: string;
  percent: number;
  chars: number;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  /** builtin = 内置工具 | collab = 协作工具 | custom = 用户自建 */
  skill_type: "builtin" | "collab" | "custom";
  tags: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
  files: SkillFile[];
  composition: SkillComposition[];
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const LANG_COLORS: Record<string, string> = {
  python: "#3b82f6",
  markdown: "#8b5cf6",
  typescript: "#06b6d4",
  javascript: "#f59e0b",
  json: "#10b981",
  yaml: "#f97316",
  shell: "#6b7280",
  text: "#6b7280",
};

const LANG_LABELS: Record<string, string> = {
  python: "Python",
  markdown: "Markdown",
  typescript: "TypeScript",
  javascript: "JavaScript",
  json: "JSON",
  yaml: "YAML",
  shell: "Shell",
  text: "Text",
};

const TYPE_FILTERS = [
  { value: "all", label: "全部" },
  { value: "builtin", label: "内置" },
  { value: "collab", label: "协作" },
  { value: "custom", label: "自建" },
];

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso + "Z");
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", year: "numeric" });
}

// ── 子组件：文件构成进度条（GitHub 风格）────────────────────────────────────

function CompositionBar({ composition }: { composition: SkillComposition[] }) {
  if (!composition.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* 进度条 */}
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          gap: 1,
        }}
      >
        {composition.map((c) => (
          <div
            key={c.language}
            style={{
              width: `${c.percent}%`,
              background: LANG_COLORS[c.language] ?? "#6b7280",
              transition: "width 0.3s ease",
            }}
            title={`${LANG_LABELS[c.language] ?? c.language}: ${c.percent}%`}
          />
        ))}
      </div>
      {/* 图例 */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {composition.map((c) => (
          <div key={c.language} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: LANG_COLORS[c.language] ?? "#6b7280",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {LANG_LABELS[c.language] ?? c.language}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 子组件：Skill 卡片 ────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onToggle,
  onDelete,
  onPreview,
}: {
  skill: Skill;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onPreview: (skill: Skill) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isBuiltin = skill.skill_type === "builtin";
  const isCollab = skill.skill_type === "collab";

  // 根据类型决定颜色主题
  const themeColor = isBuiltin ? "#3b82f6" : isCollab ? "#10b981" : "#8b5cf6";
  const themeBg = isBuiltin
    ? "rgba(59,130,246,0.12)"
    : isCollab
    ? "rgba(16,185,129,0.12)"
    : "rgba(139,92,246,0.12)";
  const hoverBorderColor = isBuiltin
    ? "rgba(59,130,246,0.3)"
    : isCollab
    ? "rgba(16,185,129,0.3)"
    : "rgba(139,92,246,0.3)";
  const hoverShadowColor = isBuiltin
    ? "rgba(59,130,246,0.1)"
    : isCollab
    ? "rgba(16,185,129,0.1)"
    : "rgba(139,92,246,0.1)";

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        background: "var(--card-bg)",
        border: `1px solid ${hovering ? hoverBorderColor : "var(--border-color)"}`,
        borderRadius: 12,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: "border-color 0.2s, box-shadow 0.2s",
        boxShadow: hovering ? `0 0 0 1px ${hoverShadowColor}` : "none",
        opacity: skill.enabled ? 1 : 0.55,
        position: "relative",
      }}
    >
      {/* 顶部：图标 + 名称 + 类型徽章 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: themeBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {isBuiltin ? (
            <Zap size={18} style={{ color: themeColor }} />
          ) : isCollab ? (
            <Users size={18} style={{ color: themeColor }} />
          ) : (
            <Code2 size={18} style={{ color: themeColor }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {skill.name}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 4,
                background: `${themeColor}26`,
                color: themeColor,
                fontWeight: 500,
                letterSpacing: "0.02em",
                flexShrink: 0,
              }}
            >
              {isBuiltin ? "内置" : isCollab ? "协作" : "自建"}
            </span>
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              marginTop: 4,
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {skill.description || "暂无描述"}
          </p>
        </div>
      </div>

      {/* 文件构成进度条 */}
      {skill.composition.length > 0 && (
        <CompositionBar composition={skill.composition} />
      )}

      {/* 标签 */}
      {skill.tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {skill.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 20,
                background: "rgba(255,255,255,0.05)",
                color: "var(--text-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 底部：文件数 + 日期 + 操作按钮 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <FileText size={11} />
            {skill.files.length} 个文件
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {formatDate(skill.created_at)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* 预览 */}
          <button
            onClick={() => onPreview(skill)}
            title="预览内容"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 6px",
              borderRadius: 6,
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <Eye size={14} />
          </button>

          {/* 启用/禁用 */}
          <button
            onClick={() => onToggle(skill.id, !skill.enabled)}
            title={skill.enabled ? "禁用" : "启用"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 6px",
              borderRadius: 6,
              color: skill.enabled ? "#22c55e" : "var(--text-muted)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {skill.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>

          {/* 删除（内置/协作工具不可删） */}
          {!isBuiltin && !isCollab && (
            <button
              onClick={() => {
                if (deleting) return;
                setDeleting(true);
                onDelete(skill.id);
              }}
              title="删除"
              style={{
                background: "none",
                border: "none",
                cursor: deleting ? "not-allowed" : "pointer",
                padding: "4px 6px",
                borderRadius: 6,
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              {deleting ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 子组件：代码高亮块（简单版，无依赖）────────────────────────────────────

function CodeBlock({ content, language }: { content: string; language: string }) {
  return (
    <pre
      style={{
        background: "#0d0d0d",
        border: "1px solid var(--border-color)",
        borderRadius: 8,
        padding: "14px 16px",
        fontSize: 12,
        lineHeight: 1.7,
        color: "#e5e5e5",
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: 400,
        margin: 0,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        whiteSpace: "pre",
      }}
    >
      <code>{content}</code>
    </pre>
  );
}

// ── 子组件：Skill 预览弹窗 ────────────────────────────────────────────────────

// ── 文件图标（按语言/扩展名）────────────────────────────────────────────────

function FileIcon({ language, size = 14 }: { language: string; size?: number }) {
  const color = LANG_COLORS[language] ?? "#6b7280";
  if (language === "python") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M8 1C4.5 1 4 2.5 4 4v1h4v.5H2.5C1.1 5.5 0 6.6 0 8s1.1 2.5 2.5 2.5H4V12c0 1.5.5 3 4 3s4-1.5 4-3v-1H8v-.5h5.5C14.9 10.5 16 9.4 16 8s-1.1-2.5-2.5-2.5H12V4c0-1.5-.5-3-4-3z" fill={color} />
      </svg>
    );
  }
  if (language === "markdown") {
    return <FileText size={size} style={{ color }} />;
  }
  return <Code2 size={size} style={{ color }} />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Skill 预览弹窗（仓库风格）────────────────────────────────────────────────

function PreviewModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  // null = 文件列表视图，number = 查看某个文件
  const [activeFile, setActiveFile] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeFile !== null) setActiveFile(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, activeFile]);

  const file = activeFile !== null ? skill.files[activeFile] : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#111111",
          border: "1px solid var(--border-color)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 820,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── 头部 ── */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* 返回按钮（查看文件时显示） */}
            {activeFile !== null && (
              <button
                onClick={() => setActiveFile(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: "2px 4px",
                  borderRadius: 5,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  marginRight: 2,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              </button>
            )}
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: skill.skill_type === "builtin"
                  ? "rgba(59,130,246,0.12)"
                  : skill.skill_type === "collab"
                  ? "rgba(16,185,129,0.12)"
                  : "rgba(139,92,246,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {skill.skill_type === "builtin" ? (
                <Zap size={14} style={{ color: "#3b82f6" }} />
              ) : skill.skill_type === "collab" ? (
                <Users size={14} style={{ color: "#10b981" }} />
              ) : (
                <Code2 size={14} style={{ color: "#8b5cf6" }} />
              )}
            </div>
            <div>
              {/* 面包屑路径 */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                <span
                  style={{ cursor: activeFile !== null ? "pointer" : "default", color: activeFile !== null ? "var(--text-secondary)" : "var(--text-primary)" }}
                  onClick={() => setActiveFile(null)}
                >
                  {skill.name}
                </span>
                {activeFile !== null && file && (
                  <>
                    <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text-primary)" }}>{file.filename}</span>
                  </>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                {activeFile !== null && file
                  ? `${LANG_LABELS[file.language] ?? file.language} · ${formatBytes(new TextEncoder().encode(file.content).length)}`
                  : `${skill.files.length} 个文件 · ${
                      skill.skill_type === "builtin" ? "内置 Skill"
                      : skill.skill_type === "collab" ? "协作 Skill"
                      : "自建 Skill"
                    }`
                }
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              borderRadius: 6,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── 主体 ── */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {activeFile === null ? (
            /* 文件列表视图 */
            <div style={{ flex: 1, overflow: "auto" }}>
              {/* 文件夹头 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <FolderOpen size={14} style={{ color: "#f59e0b" }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                  {skill.name.toLowerCase().replace(/\s+/g, "-")}
                </span>
              </div>

              {/* 文件行列表 */}
              {skill.files.map((f, i) => {
                const bytes = new TextEncoder().encode(f.content).length;
                return (
                  <div
                    key={f.id}
                    onClick={() => setActiveFile(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "11px 20px 11px 36px",
                      borderBottom: "1px solid var(--border-subtle)",
                      cursor: "pointer",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* 文件图标 */}
                    <div style={{ width: 20, flexShrink: 0, display: "flex", alignItems: "center" }}>
                      <FileIcon language={f.language} size={15} />
                    </div>
                    {/* 文件名 */}
                    <span
                      style={{
                        flex: 1,
                        fontSize: 13,
                        color: "var(--text-primary)",
                        marginLeft: 8,
                      }}
                    >
                      {f.filename}
                    </span>
                    {/* 文件大小 */}
                    <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
                      {formatBytes(bytes)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 文件内容视图 */
            <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
              {file ? (
                file.language === "markdown" ? (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.85,
                      color: "var(--text-primary)",
                      whiteSpace: "pre-wrap",
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    }}
                  >
                    {file.content}
                  </div>
                ) : (
                  <CodeBlock content={file.content} language={file.language} />
                )
              ) : null}
            </div>
          )}
        </div>

        {/* ── 底部构成条（始终显示）── */}
        {skill.composition.length > 0 && (
          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--border-color)",
              flexShrink: 0,
            }}
          >
            <CompositionBar composition={skill.composition} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 子组件：新建 Skill 弹窗 ───────────────────────────────────────────────────

function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [files, setFiles] = useState<Array<{ filename: string; content: string }>>([
    { filename: "README.md", content: "" },
  ]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const addFile = () => {
    setFiles((prev) => [...prev, { filename: `file_${prev.length + 1}.py`, content: "" }]);
    setActiveFileIdx(files.length);
  };

  const removeFile = (idx: number) => {
    if (files.length <= 1) return;
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setActiveFileIdx(Math.max(0, activeFileIdx - 1));
  };

  const updateFile = (idx: number, key: "filename" | "content", value: string) => {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, [key]: value } : f)));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(e.target.files ?? []);
    for (const uf of uploadedFiles) {
      const text = await uf.text();
      setFiles((prev) => {
        const existing = prev.findIndex((f) => f.filename === uf.name);
        if (existing >= 0) {
          return prev.map((f, i) => (i === existing ? { ...f, content: text } : f));
        }
        return [...prev, { filename: uf.name, content: text }];
      });
    }
    if (uploadedFiles.length > 0) {
      setActiveFileIdx(files.length);
    }
    e.target.value = "";
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Skill 名称不能为空");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/v1/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          skill_type: "custom",
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          files: files.filter((f) => f.content.trim()),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail ?? "创建失败");
      }
      const skill: Skill = await resp.json();
      onCreated(skill);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  };

  const activeFile = files[activeFileIdx];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#111111",
          border: "1px solid var(--border-color)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 800,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(139,92,246,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Plus size={16} style={{ color: "#8b5cf6" }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              新建 Skill
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              borderRadius: 6,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, overflow: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* 基本信息 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
                Skill 名称 <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：FileReader"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
                标签（逗号分隔）
              </label>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="例如：file, reader, utility"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述这个 Skill 的功能..."
              rows={2}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border-color)",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                color: "var(--text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* 文件编辑区 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
                文件内容
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".py,.md,.ts,.js,.json,.yaml,.yml,.sh,.txt"
                  onChange={handleUpload}
                  style={{ display: "none" }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Upload size={11} />
                  上传文件
                </button>
                <button
                  onClick={addFile}
                  style={{
                    background: "rgba(139,92,246,0.1)",
                    border: "1px solid rgba(139,92,246,0.3)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    color: "#a78bfa",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Plus size={11} />
                  添加文件
                </button>
              </div>
            </div>

            {/* 文件标签页 */}
            <div
              style={{
                display: "flex",
                gap: 0,
                borderBottom: "1px solid var(--border-color)",
                overflowX: "auto",
              }}
            >
              {files.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderBottom: i === activeFileIdx ? "2px solid #8b5cf6" : "2px solid transparent",
                    cursor: "pointer",
                    color: i === activeFileIdx ? "#a78bfa" : "var(--text-secondary)",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                  onClick={() => setActiveFileIdx(i)}
                >
                  {f.filename}
                  {files.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        padding: 0,
                        display: "flex",
                        lineHeight: 1,
                      }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* 文件名输入 */}
            {activeFile && (
              <input
                value={activeFile.filename}
                onChange={(e) => updateFile(activeFileIdx, "filename", e.target.value)}
                placeholder="文件名（如 tool.py）"
                style={{
                  background: "var(--card-bg)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  outline: "none",
                  fontFamily: "monospace",
                }}
              />
            )}

            {/* 代码编辑区 */}
            {activeFile && (
              <textarea
                value={activeFile.content}
                onChange={(e) => updateFile(activeFileIdx, "content", e.target.value)}
                placeholder={
                  activeFile.filename.endsWith(".py")
                    ? "# 在这里写 Python 代码\n# 入口函数名需与 Skill 名称（snake_case）一致\n\nasync def my_skill(input: str) -> str:\n    \"\"\"工具描述\"\"\"\n    return f'处理结果: {input}'"
                    : "在这里写 Markdown 文档..."
                }
                rows={14}
                style={{
                  background: "#0d0d0d",
                  border: "1px solid var(--border-color)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  fontSize: 12,
                  color: "#e5e5e5",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  lineHeight: 1.7,
                }}
              />
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                fontSize: 12,
                color: "#f87171",
              }}
            >
              <AlertCircle size={14} />
              {error}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "8px 18px",
              fontSize: 13,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            style={{
              background: loading ? "rgba(139,92,246,0.4)" : "#8b5cf6",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              fontSize: 13,
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontWeight: 500,
            }}
          >
            {loading ? (
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Check size={14} />
            )}
            {loading ? "创建中..." : "创建 Skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [previewSkill, setPreviewSkill] = useState<Skill | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // ── 数据加载 ──
  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/v1/skills`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setSkills(data.skills ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // ── 操作 ──
  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const resp = await fetch(`${API_BASE}/v1/skills/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!resp.ok) throw new Error("更新失败");
      const updated: Skill = await resp.json();
      setSkills((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch {
      // 静默失败，不影响 UI
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const resp = await fetch(`${API_BASE}/v1/skills/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("删除失败");
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // 静默失败
    }
  };

  const handleCreated = (skill: Skill) => {
    setSkills((prev) => [skill, ...prev]);
  };

  // ── 过滤 ──
  const filtered = skills.filter((s) => {
    const matchType = typeFilter === "all" || s.skill_type === typeFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q));
    return matchType && matchSearch;
  });

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--background)",
      }}
    >
      {/* ── 顶部栏 ── */}
      <div
        style={{
          padding: "20px 24px 0",
          flexShrink: 0,
        }}
      >
        {/* 标题行 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(139,92,246,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Puzzle size={18} style={{ color: "#8b5cf6" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                MCP / Skill 中心
              </h1>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, marginTop: 2 }}>
                {skills.length} 个 Skill · {enabledCount} 个已启用
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: "#8b5cf6",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontWeight: 500,
            }}
          >
            <Plus size={14} />
            新建 Skill
          </button>
        </div>

        {/* 搜索 + 筛选 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {/* 搜索框 */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--card-bg)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0 12px",
            }}
          >
            <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Skill 名称、描述、标签..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontSize: 13,
                color: "var(--text-primary)",
                padding: "9px 0",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  padding: 0,
                  display: "flex",
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* 类型筛选 */}
          <div style={{ display: "flex", gap: 4 }}>
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                style={{
                  background: typeFilter === f.value ? "rgba(139,92,246,0.15)" : "var(--card-bg)",
                  border: `1px solid ${typeFilter === f.value ? "rgba(139,92,246,0.4)" : "var(--border-color)"}`,
                  borderRadius: 7,
                  padding: "7px 14px",
                  fontSize: 12,
                  color: typeFilter === f.value ? "#a78bfa" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontWeight: typeFilter === f.value ? 500 : 400,
                  transition: "all 0.15s",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 内容区 ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 24px" }}>
        {loading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              gap: 12,
            }}
          >
            <Loader2
              size={28}
              style={{ color: "var(--text-muted)", animation: "spin 1s linear infinite" }}
            />
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>加载中...</span>
          </div>
        ) : error ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              gap: 12,
            }}
          >
            <AlertCircle size={28} style={{ color: "#ef4444" }} />
            <span style={{ fontSize: 13, color: "#f87171" }}>{error}</span>
            <button
              onClick={fetchSkills}
              style={{
                background: "none",
                border: "1px solid var(--border-color)",
                borderRadius: 7,
                padding: "6px 14px",
                fontSize: 12,
                color: "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              重试
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 200,
              gap: 10,
            }}
          >
            <Puzzle size={32} style={{ color: "var(--text-muted)" }} />
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {searchQuery || typeFilter !== "all" ? "没有匹配的 Skill" : "还没有 Skill，点击「新建 Skill」开始"}
            </span>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onPreview={setPreviewSkill}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 弹窗 ── */}
      {previewSkill && (
        <PreviewModal skill={previewSkill} onClose={() => setPreviewSkill(null)} />
      )}
      {showCreate && (
        <CreateSkillModal onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
