"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  FolderOpen,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  X,
  Send,
  Square,
  Bot,
  Code2,
  RefreshCw,
  Save,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Bug,
  Circle,
  ChevronUp,
  Variable,
  Layers,
  Clock,
} from "lucide-react";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useChatStream, type AgentEvent } from "@/lib/hooks/use-chat-stream";

// Monaco Editor 动态加载（避免 SSR 问题）
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  ),
});

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// ── 类型定义 ──────────────────────────────────────────────────────────────────

interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
}

interface EditorTab {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallRecord[];
}

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error";
}

// 断点快照类型（兼容两种格式）
interface DebugVariable {
  name: string;
  type: string;
  value: string;
  children?: DebugVariable[];
}

interface DebugFrame {
  className: string;
  method: string;
  line: number;
}

interface SingleSnapshot {
  file: string;
  line: number;
  className?: string;
  method?: string;
  callStack?: DebugFrame[];
  variables?: DebugVariable[];
}

interface MultiBreakpoint {
  id: string | number;
  location: string;
  keyVars?: Record<string, string>;
  diff_from_prev?: { changed?: Record<string, string> };
}

interface DebugSnapshot {
  _received_at: number;
  // 单断点格式
  snapshot?: SingleSnapshot;
  mode?: string;
  // 多断点 diff 格式
  session?: string;
  breakpoints?: MultiBreakpoint[];
  callStackDiff?: string;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function extToLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    py: "python", kt: "kotlin", java: "java",
    rs: "rust", go: "go", cpp: "cpp", c: "c",
    css: "css", scss: "scss", html: "html",
    json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
    xml: "xml", sh: "shell", sql: "sql", swift: "swift",
    gradle: "groovy",
  };
  return map[ext] ?? "plaintext";
}

function getToolIcon(name: string) {
  if (name === "read_file") return "📖";
  if (name === "write_file") return "✏️";
  if (name === "list_dir") return "📁";
  if (name === "web_search") return "🔍";
  if (name === "set_breakpoint") return "🔴";
  if (name === "wait_for_breakpoint") return "⏳";
  if (name === "get_debug_snapshot") return "🐛";
  return "🔧";
}

function timeAgo(ts: number): string {
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 60) return `${sec}秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  return `${Math.floor(sec / 3600)}小时前`;
}

// ── 文件树节点组件 ────────────────────────────────────────────────────────────

function FileTreeNode({
  node,
  depth,
  activeFile,
  onFileClick,
}: {
  node: FileNode;
  depth: number;
  activeFile: string | null;
  onFileClick: (path: string, name: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isActive = node.type === "file" && node.path === activeFile;

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors hover:bg-[var(--bg-hover)]"
          style={{
            paddingLeft: `${8 + depth * 12}px`,
            color: "var(--text-secondary)",
          }}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Folder size={12} style={{ color: "#e8a838" }} />
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFile={activeFile}
            onFileClick={onFileClick}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick(node.path, node.name)}
      className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors hover:bg-[var(--bg-hover)]"
      style={{
        paddingLeft: `${8 + depth * 12}px`,
        color: isActive ? "var(--accent-primary)" : "var(--text-secondary)",
        background: isActive ? "var(--bg-hover)" : "transparent",
      }}
    >
      <File size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ── 工具调用卡片 ──────────────────────────────────────────────────────────────

function ToolCallCard({ call }: { call: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);
  const icon = getToolIcon(call.name);

  const subtitle =
    call.name === "write_file" || call.name === "read_file"
      ? (call.args.path as string) ?? ""
      : call.name === "list_dir"
      ? (call.args.path as string) || "/"
      : call.name === "set_breakpoint"
      ? `${call.args.file}:${call.args.line}`
      : "";

  return (
    <div
      className="my-1 rounded-lg border text-xs"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2"
      >
        <span>{icon}</span>
        <span style={{ color: "var(--text-primary)" }} className="font-mono font-medium">
          {call.name}
        </span>
        {subtitle && (
          <span className="truncate" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </span>
        )}
        <span className="ml-auto flex-shrink-0">
          {call.status === "running" && (
            <Loader2 size={12} className="animate-spin" style={{ color: "var(--accent-primary)" }} />
          )}
          {call.status === "done" && <CheckCircle2 size={12} style={{ color: "#10b981" }} />}
          {call.status === "error" && <AlertCircle size={12} style={{ color: "#ef4444" }} />}
        </span>
      </button>
      {expanded && call.result && (
        <div
          className="border-t px-3 py-2 font-mono text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-muted)",
            whiteSpace: "pre-wrap",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {call.result}
        </div>
      )}
    </div>
  );
}

// ── 断点面板组件 ──────────────────────────────────────────────────────────────

function DebugPanel({
  snapshot,
  isWaiting,
  onRefresh,
}: {
  snapshot: DebugSnapshot | null;
  isWaiting: boolean;
  onRefresh: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<"vars" | "stack">("vars");

  const s = snapshot?.snapshot;
  const bps = snapshot?.breakpoints;

  // 提取文件/行号信息
  const location = s
    ? `${s.file}:${s.line}`
    : bps && bps.length > 0
    ? bps[0].location
    : null;

  const receivedAt = snapshot?._received_at ?? 0;

  return (
    <div
      className="border-t flex-shrink-0"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {/* 面板标题栏 */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none"
        style={{ background: "var(--bg-secondary)" }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <Bug size={12} style={{ color: snapshot ? "#ef4444" : "var(--text-muted)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          断点调试
        </span>
        {isWaiting && (
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs"
            style={{ background: "rgba(251,191,36,0.15)", color: "#f59e0b" }}
          >
            <Loader2 size={9} className="animate-spin" />
            等待命中
          </span>
        )}
        {snapshot && !isWaiting && (
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs"
            style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
          >
            <Circle size={7} className="fill-current" />
            已命中
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            className="rounded p-0.5 transition-colors hover:bg-[var(--bg-hover)]"
            title="刷新快照"
          >
            <RefreshCw size={10} style={{ color: "var(--text-muted)" }} />
          </button>
          {collapsed
            ? <ChevronUp size={11} style={{ color: "var(--text-muted)" }} />
            : <ChevronDown size={11} style={{ color: "var(--text-muted)" }} />
          }
        </div>
      </div>

      {/* 面板内容 */}
      {!collapsed && (
        <div style={{ background: "var(--bg-primary)" }}>
          {/* 等待状态 */}
          {isWaiting && !snapshot && (
            <div className="flex flex-col items-center gap-2 py-5">
              <div className="relative">
                <div
                  className="h-8 w-8 rounded-full border-2 animate-ping absolute"
                  style={{ borderColor: "rgba(239,68,68,0.3)" }}
                />
                <div
                  className="h-8 w-8 rounded-full border-2 flex items-center justify-center"
                  style={{ borderColor: "#ef4444" }}
                >
                  <Circle size={10} style={{ color: "#ef4444" }} className="fill-current" />
                </div>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                等待断点命中...
              </p>
              <p className="text-xs text-center px-4" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                请在 Android Studio 中运行项目
              </p>
            </div>
          )}

          {/* 无快照且不在等待 */}
          {!isWaiting && !snapshot && (
            <div className="flex flex-col items-center gap-2 py-5">
              <Bug size={20} style={{ color: "var(--text-muted)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                暂无断点快照
              </p>
              <p className="text-xs text-center px-4" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                让 Agent 调用 set_breakpoint 打断点，或在 AS 中手动命中断点
              </p>
            </div>
          )}

          {/* 有快照时展示 */}
          {snapshot && (
            <div className="text-xs">
              {/* 位置信息 */}
              <div
                className="flex items-center gap-2 px-3 py-2 border-b"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <Circle size={8} style={{ color: "#ef4444" }} className="fill-current flex-shrink-0" />
                <span className="font-mono truncate" style={{ color: "var(--text-primary)" }}>
                  {location ?? "未知位置"}
                </span>
                {s?.className && (
                  <span className="ml-auto flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    {s.className.split(".").pop()}.{s.method}
                  </span>
                )}
              </div>

              {/* 时间戳 */}
              <div
                className="flex items-center gap-1.5 px-3 py-1 border-b"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                <Clock size={9} />
                <span>{timeAgo(receivedAt)}</span>
                {bps && (
                  <span className="ml-auto">
                    {bps.length} 个断点
                  </span>
                )}
              </div>

              {/* Tab 切换：变量 / 调用栈 */}
              {s && (
                <>
                  <div
                    className="flex border-b"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    {(["vars", "stack"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveSection(tab)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors"
                        style={{
                          color: activeSection === tab ? "var(--accent-primary)" : "var(--text-muted)",
                          borderBottom: activeSection === tab
                            ? "2px solid var(--accent-primary)"
                            : "2px solid transparent",
                        }}
                      >
                        {tab === "vars"
                          ? <><Variable size={10} />变量</>
                          : <><Layers size={10} />调用栈</>
                        }
                      </button>
                    ))}
                  </div>

                  {/* 变量列表 */}
                  {activeSection === "vars" && (
                    <div className="max-h-48 overflow-y-auto">
                      {(s.variables ?? []).length === 0 ? (
                        <p className="px-3 py-3" style={{ color: "var(--text-muted)" }}>无变量信息</p>
                      ) : (
                        (s.variables ?? []).slice(0, 30).map((v, i) => (
                          <div key={i}>
                            <div
                              className="flex items-start gap-2 px-3 py-1 hover:bg-[var(--bg-hover)]"
                            >
                              <span className="font-mono" style={{ color: "#60a5fa", flexShrink: 0 }}>
                                {v.name}
                              </span>
                              <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                                {v.type}
                              </span>
                              <span
                                className="ml-auto font-mono truncate"
                                style={{ color: "var(--text-primary)" }}
                                title={v.value}
                              >
                                {v.value}
                              </span>
                            </div>
                            {v.children?.slice(0, 5).map((child, j) => (
                              <div
                                key={j}
                                className="flex items-start gap-2 px-3 py-0.5 hover:bg-[var(--bg-hover)]"
                                style={{ paddingLeft: "24px" }}
                              >
                                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                                  .{child.name}
                                </span>
                                <span style={{ color: "var(--text-muted)", flexShrink: 0, fontSize: "10px" }}>
                                  {child.type}
                                </span>
                                <span
                                  className="ml-auto font-mono truncate"
                                  style={{ color: "var(--text-secondary)" }}
                                  title={child.value}
                                >
                                  {child.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* 调用栈 */}
                  {activeSection === "stack" && (
                    <div className="max-h-48 overflow-y-auto">
                      {(s.callStack ?? []).length === 0 ? (
                        <p className="px-3 py-3" style={{ color: "var(--text-muted)" }}>无调用栈信息</p>
                      ) : (
                        (s.callStack ?? []).slice(0, 10).map((frame, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--bg-hover)]"
                          >
                            <span
                              className="flex-shrink-0 w-4 text-center rounded text-xs"
                              style={{
                                background: i === 0 ? "rgba(239,68,68,0.15)" : "var(--bg-secondary)",
                                color: i === 0 ? "#ef4444" : "var(--text-muted)",
                              }}
                            >
                              {i}
                            </span>
                            <span className="font-mono truncate" style={{ color: "var(--text-secondary)" }}>
                              {frame.className?.split(".")?.pop() ?? frame.className}.{frame.method}
                            </span>
                            <span className="ml-auto flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                              L{frame.line}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              {/* 多断点 diff 格式 */}
              {bps && (
                <div className="max-h-48 overflow-y-auto">
                  {bps.slice(0, 5).map((bp, i) => (
                    <div
                      key={i}
                      className="border-b px-3 py-2"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Circle size={7} style={{ color: "#ef4444" }} className="fill-current" />
                        <span className="font-mono" style={{ color: "var(--text-primary)" }}>
                          #{bp.id} {bp.location}
                        </span>
                      </div>
                      {bp.keyVars && Object.keys(bp.keyVars).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(bp.keyVars).slice(0, 6).map(([k, v]) => (
                            <span
                              key={k}
                              className="rounded px-1.5 py-0.5 font-mono"
                              style={{
                                background: "var(--bg-secondary)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {k}={v}
                            </span>
                          ))}
                        </div>
                      )}
                      {bp.diff_from_prev?.changed && Object.keys(bp.diff_from_prev.changed).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(bp.diff_from_prev.changed).slice(0, 4).map(([k, v]) => (
                            <span
                              key={k}
                              className="rounded px-1.5 py-0.5 font-mono"
                              style={{
                                background: "rgba(251,191,36,0.1)",
                                color: "#f59e0b",
                              }}
                            >
                              △ {k}={v}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function EditorPage() {
  // ── 工作区状态 ──
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [openingWorkspace, setOpeningWorkspace] = useState(false);

  // ── 编辑器状态 ──
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Agent 对话状态 ──
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const pendingToolCallsRef = useRef<Map<string, ToolCallRecord>>(new Map());
  const currentAssistantIdRef = useRef<string | null>(null);

  // ── 断点调试状态 ──
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null);
  const [isWaitingBreakpoint, setIsWaitingBreakpoint] = useState(false);
  const debugPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── File System Access API（原生文件夹选择器）──
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const dirHandleRootRef = useRef<string>("");

  const { models, loading: modelsLoading } = useAvailableModels();
  const { streaming, sendMessage, abort } = useChatStream();

  // 自动选第一个模型
  useEffect(() => {
    if (models.length > 0 && !selectedModelId) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  // 滚动到底部
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // 启动时检查是否已有工作区
  useEffect(() => {
    fetch(`${BACKEND_URL}/v1/workspace/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.is_open) {
          setWorkspaceRoot(data.root);
          setWorkspaceName(data.name);
          loadFileTree();
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 断点快照轮询 ──────────────────────────────────────────────────────────

  const fetchDebugSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/v1/debug/snapshot/latest`);
      if (res.ok) {
        const data = await res.json();
        if (data.has_snapshot) {
          setDebugSnapshot(data.snapshot as DebugSnapshot);
        }
      }
    } catch {
      // 忽略网络错误
    }
  }, []);

  // 启动时拉取一次快照，之后每 5 秒轮询
  useEffect(() => {
    fetchDebugSnapshot();
    debugPollRef.current = setInterval(fetchDebugSnapshot, 5000);
    return () => {
      if (debugPollRef.current) clearInterval(debugPollRef.current);
    };
  }, [fetchDebugSnapshot]);

  // ── 工作区操作 ──

  const loadFileTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/v1/workspace/tree`);
      if (res.ok) {
        const data = await res.json();
        setFileTree(data.tree ?? []);
      }
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const handleOpenWorkspace = useCallback(async (pathOverride?: string) => {
    const path = (pathOverride ?? workspacePath).trim();
    if (!path) return;
    setOpeningWorkspace(true);
    try {
      const res = await fetch(`${BACKEND_URL}/v1/workspace/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail ?? "打开工作区失败");
        return;
      }
      const data = await res.json();
      setWorkspaceRoot(data.root);
      setWorkspaceName(data.name);
      await loadFileTree();
    } finally {
      setOpeningWorkspace(false);
    }
  }, [workspacePath, loadFileTree]);

  // 系统原生文件夹选择器（File System Access API）
  const handlePickFolder = useCallback(async () => {
    // 检查浏览器是否支持 showDirectoryPicker
    if (!("showDirectoryPicker" in window)) {
      // 降级：提示用户手动输入路径
      alert("当前浏览器不支持文件夹选择器，请手动输入路径。\n（推荐使用 Chrome / Edge 最新版）");
      return;
    }
    try {
      // 弹出系统原生文件夹选择对话框
      const dirHandle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
      const dirName = dirHandle.name;

      // 直接用 File System Access API 在前端构建文件树（不依赖后端路径）
      setOpeningWorkspace(true);

      // 递归读取目录结构（最多 3 层，避免太慢）
      async function readDirHandle(
        handle: FileSystemDirectoryHandle,
        depth: number,
        basePath: string
      ): Promise<FileNode[]> {
        const nodes: FileNode[] = [];
        const IGNORE = new Set(["node_modules", ".git", "__pycache__", ".DS_Store", "dist", "build", ".next"]);
        for await (const [name, entry] of (handle as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
          if (IGNORE.has(name)) continue;
          const path = `${basePath}/${name}`;
          if (entry.kind === "directory" && depth < 4) {
            const children = await readDirHandle(entry as FileSystemDirectoryHandle, depth + 1, path);
            nodes.push({ name, path, type: "dir", children });
          } else if (entry.kind === "file") {
            nodes.push({ name, path, type: "file" });
          }
        }
        // 目录在前，文件在后，各自按名称排序
        nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return nodes;
      }

      // 读取文件树
      const tree = await readDirHandle(dirHandle, 0, dirName);

      // 存储 dirHandle 供后续文件读写使用
      dirHandleRef.current = dirHandle;
      dirHandleRootRef.current = dirName;

      // 设置前端状态（不依赖后端路径）
      setWorkspaceRoot(dirName);
      setWorkspaceName(dirName);
      setFileTree(tree);
      setWorkspacePath(dirName);

      // 同时尝试通知后端（如果后端能找到对应路径则 Agent 工具也能用）
      // 这里用 dirName 作为路径尝试，后端找不到也没关系（前端已经有文件树了）
      try {
        await fetch(`${BACKEND_URL}/v1/workspace/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dirName }),
        });
      } catch {
        // 后端打开失败不影响前端文件树展示
      }

      setOpeningWorkspace(false);
    } catch (err: unknown) {
      // 用户取消选择（AbortError）不报错
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("pick folder failed", err);
      }
      setOpeningWorkspace(false);
    }
  }, []);

  // ── 文件操作 ──

  // 通过 File System Access API 根据相对路径找到文件 handle
  const resolveFileHandle = useCallback(async (relativePath: string): Promise<FileSystemFileHandle | null> => {
    const handle = dirHandleRef.current;
    if (!handle) return null;
    // relativePath 格式：dirName/subdir/file.ts，去掉根目录名前缀
    const root = dirHandleRootRef.current;
    const parts = relativePath.startsWith(root + "/")
      ? relativePath.slice(root.length + 1).split("/")
      : relativePath.split("/").slice(1); // 兼容其他格式
    try {
      let current: FileSystemDirectoryHandle = handle;
      for (let i = 0; i < parts.length - 1; i++) {
        current = await current.getDirectoryHandle(parts[i]);
      }
      return await current.getFileHandle(parts[parts.length - 1]);
    } catch {
      return null;
    }
  }, []);

  const handleFileClick = useCallback(async (path: string, name: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveTabPath(path);
      return;
    }
    try {
      let content = "";

      // 优先用 File System Access API（原生选择器模式）
      if (dirHandleRef.current) {
        const fileHandle = await resolveFileHandle(path);
        if (fileHandle) {
          const file = await fileHandle.getFile();
          content = await file.text();
        } else {
          return; // 找不到文件
        }
      } else {
        // 降级：通过后端 HTTP 接口读取
        const res = await fetch(
          `${BACKEND_URL}/v1/workspace/file?path=${encodeURIComponent(path)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        content = data.content;
      }

      const tab: EditorTab = {
        path,
        name,
        content,
        language: extToLanguage(name),
        modified: false,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabPath(path);
    } catch (e) {
      console.error("load file failed", e);
    }
  }, [tabs, resolveFileHandle]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!activeTabPath) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === activeTabPath ? { ...t, content: value ?? "", modified: true } : t
      )
    );
  }, [activeTabPath]);

  const handleSave = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activeTabPath);
    if (!tab) return;
    setSaving(true);
    try {
      if (dirHandleRef.current) {
        // 原生模式：通过 File System Access API 写文件
        const fileHandle = await resolveFileHandle(tab.path);
        if (fileHandle) {
          const writable = await fileHandle.createWritable();
          await writable.write(tab.content);
          await writable.close();
          setTabs((prev) =>
            prev.map((t) => (t.path === activeTabPath ? { ...t, modified: false } : t))
          );
        }
      } else {
        // 降级：通过后端 HTTP 接口写文件
        const res = await fetch(`${BACKEND_URL}/v1/workspace/file`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: tab.path, content: tab.content }),
        });
        if (res.ok) {
          setTabs((prev) =>
            prev.map((t) => (t.path === activeTabPath ? { ...t, modified: false } : t))
          );
        }
      }
    } finally {
      setSaving(false);
    }
  }, [tabs, activeTabPath, resolveFileHandle]);

  // Cmd+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const closeTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (path === activeTabPath) {
        const idx = prev.findIndex((t) => t.path === path);
        setActiveTabPath(next[Math.max(0, idx - 1)]?.path ?? null);
      }
      return next;
    });
  }, [activeTabPath]);

  // ── Agent 对话 ──

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null;
  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];

  const buildSystemPrompt = useCallback(() => {
    const parts = [
      "你是一个代码助手，可以直接读写用户本地工作区的文件，也可以辅助 Android 断点调试。",
      "你拥有以下工具：",
      "- list_dir：列出工作区目录结构",
      "- read_file：读取文件内容（支持 start_line/end_line 分段读取）",
      "- write_file：写入/覆盖文件内容（会完整覆盖，写前请先读取原文件）",
      "- get_debug_snapshot：获取 Android Studio 断点快照（变量、调用栈）",
      "- set_breakpoint：向 Android Studio 推送断点推荐",
      "- wait_for_breakpoint：等待新断点命中（用户需在 AS 中运行项目）",
    ];
    if (workspaceRoot) {
      parts.push(`\n当前工作区根目录：${workspaceRoot}`);
    }
    if (activeTab) {
      parts.push(`当前打开的文件：${activeTab.path}`);
    }
    return parts.join("\n");
  }, [workspaceRoot, activeTab]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !selectedModel || streaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
    };

    setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputText("");
    currentAssistantIdRef.current = assistantId;
    pendingToolCallsRef.current.clear();

    const history = chatMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: String(Date.now()),
    }));

    await sendMessage(
      selectedModel,
      history,
      text,
      // onDelta
      (delta) => {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m
          )
        );
      },
      // onDone
      () => {
        setIsWaitingBreakpoint(false);
      },
      // onError
      (err) => {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `[错误] ${err}` } : m
          )
        );
        setIsWaitingBreakpoint(false);
      },
      // onAgentEvent
      (event: AgentEvent) => {
        if (event.type === "tool_call") {
          const record: ToolCallRecord = {
            name: event.name,
            args: event.args,
            status: "running",
          };
          // 检测 wait_for_breakpoint 调用，激活等待状态
          if (event.name === "wait_for_breakpoint") {
            setIsWaitingBreakpoint(true);
          }
          pendingToolCallsRef.current.set(event.name, record);
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolCalls: [...(m.toolCalls ?? []), record] }
                : m
            )
          );
        } else if (event.type === "tool_result") {
          // wait_for_breakpoint 完成，关闭等待状态并刷新快照
          if (event.name === "wait_for_breakpoint") {
            setIsWaitingBreakpoint(false);
            fetchDebugSnapshot();
          }
          // get_debug_snapshot 完成，刷新快照
          if (event.name === "get_debug_snapshot") {
            fetchDebugSnapshot();
          }

          setChatMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;
              const calls = [...(m.toolCalls ?? [])];
              const idx = calls.map((c, i) => ({ c, i }))
                .reverse()
                .find(({ c }) => c.name === event.name && c.status === "running")?.i;
              if (idx !== undefined) {
                calls[idx] = { ...calls[idx], result: event.content, status: "done" };
              }
              // write_file 完成，自动刷新编辑器中对应文件
              if (event.name === "write_file") {
                const writtenPath = calls[idx ?? -1]?.args?.path as string | undefined;
                if (writtenPath && writtenPath === activeTabPath) {
                  fetch(`${BACKEND_URL}/v1/workspace/file?path=${encodeURIComponent(writtenPath)}`)
                    .then((r) => r.json())
                    .then((data) => {
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.path === writtenPath
                            ? { ...t, content: data.content, modified: false }
                            : t
                        )
                      );
                    })
                    .catch(() => {});
                }
              }
              return { ...m, toolCalls: calls };
            })
          );
        }
      },
      undefined, // onThinkingDelta
      true,      // agentMode
      undefined, // context
      null,      // sessionId
      buildSystemPrompt(),
      [],        // attachments
      ["list_dir", "read_file", "write_file", "web_search",
       "get_debug_snapshot", "set_breakpoint", "wait_for_breakpoint"],
    );
  }, [
    inputText, selectedModel, streaming, chatMessages,
    sendMessage, buildSystemPrompt, activeTabPath, fetchDebugSnapshot,
  ]);

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  const activeTabData = tabs.find((t) => t.path === activeTabPath);

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* ══ 左栏：文件树 ══════════════════════════════════════════════════════ */}
      <div
        className="flex w-52 flex-shrink-0 flex-col border-r"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
      >
        {/* 工作区标题 */}
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Code2 size={13} style={{ color: "var(--accent-primary)" }} />
          <span className="truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            {workspaceName ?? "未打开工作区"}
          </span>
          {workspaceRoot && (
            <button
              onClick={loadFileTree}
              className="ml-auto rounded p-0.5 transition-colors hover:bg-[var(--bg-hover)]"
              title="刷新文件树"
            >
              <RefreshCw size={11} style={{ color: "var(--text-muted)" }} className={treeLoading ? "animate-spin" : ""} />
            </button>
          )}
        </div>

        {/* 打开工作区 */}
        {!workspaceRoot ? (
          <div className="flex flex-col gap-2 p-3">
            {/* 主按钮：点击弹出系统文件夹选择器 */}
            <button
              onClick={handlePickFolder}
              disabled={openingWorkspace}
              className="flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--accent-primary)", color: "#fff" }}
            >
              {openingWorkspace ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FolderOpen size={13} />
              )}
              选择文件夹...
            </button>
            {/* 分隔线 */}
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>或输入路径</span>
              <div className="flex-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />
            </div>
            {/* 手动输入路径 */}
            <input
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpenWorkspace()}
              placeholder="/Users/me/projects/my-app"
              className="w-full rounded border px-2 py-1.5 text-xs outline-none focus:border-[var(--accent-primary)]"
              style={{
                background: "var(--bg-primary)",
                borderColor: "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            />
            {workspacePath.trim() && (
              <button
                onClick={() => handleOpenWorkspace()}
                disabled={openingWorkspace}
                className="flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                style={{
                  background: "var(--bg-hover)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {openingWorkspace ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ChevronRight size={12} />
                )}
                打开此路径
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 文件树 */}
            <div className="flex-1 overflow-y-auto py-1">
              {treeLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                </div>
              ) : fileTree.length === 0 ? (
                <p className="px-3 py-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  目录为空
                </p>
              ) : (
                fileTree.map((node) => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    activeFile={activeTabPath}
                    onFileClick={handleFileClick}
                  />
                ))
              )}
            </div>
            {/* 切换工作区 */}
            <div className="border-t p-2" style={{ borderColor: "var(--border-subtle)" }}>
              <button
                onClick={() => {
                  setWorkspaceRoot(null);
                  setWorkspaceName(null);
                  setFileTree([]);
                  setWorkspacePath("");
                  dirHandleRef.current = null;
                  dirHandleRootRef.current = "";
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--text-muted)" }}
              >
                <FolderOpen size={11} />
                切换工作区
              </button>
            </div>
          </>
        )}
      </div>

      {/* ══ 中栏：Monaco 编辑器 ═══════════════════════════════════════════════ */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Tab 栏 */}
        <div
          className="flex items-center overflow-x-auto border-b"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)", minHeight: "36px" }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.path}
              onClick={() => setActiveTabPath(tab.path)}
              className="group flex cursor-pointer items-center gap-2 border-r px-3 py-2 text-xs transition-colors"
              style={{
                borderColor: "var(--border-subtle)",
                background: tab.path === activeTabPath ? "var(--bg-primary)" : "transparent",
                color: tab.path === activeTabPath ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: tab.path === activeTabPath
                  ? "2px solid var(--accent-primary)"
                  : "2px solid transparent",
                flexShrink: 0,
              }}
            >
              <span className="max-w-[120px] truncate">
                {tab.name}
                {tab.modified && (
                  <span style={{ color: "var(--accent-primary)" }}> ●</span>
                )}
              </span>
              <button
                onClick={(e) => closeTab(tab.path, e)}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--bg-hover)] group-hover:opacity-100"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {/* 保存按钮 */}
          {activeTabData?.modified && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 text-xs transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--accent-primary)", flexShrink: 0 }}
              title="保存文件 (Cmd+S)"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              保存
            </button>
          )}
        </div>

        {/* 编辑器主体 */}
        <div className="flex-1 overflow-hidden">
          {activeTabData ? (
            <MonacoEditor
              key={activeTabData.path}
              height="100%"
              language={activeTabData.language}
              value={activeTabData.content}
              onChange={handleEditorChange}
              theme="vs-dark"
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
                fontLigatures: true,
                lineHeight: 21,
                minimap: { enabled: true, scale: 1 },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 2,
                automaticLayout: true,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                renderLineHighlight: "all",
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: true, indentation: true },
                padding: { top: 10, bottom: 10 },
              }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Code2 size={36} style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {workspaceRoot ? "从左侧文件树选择文件" : "先打开一个工作区"}
              </p>
            </div>
          )}
        </div>

        {/* 底部状态栏 */}
        <div
          className="flex items-center gap-3 border-t px-4 py-1 text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-secondary)",
            color: "var(--text-muted)",
          }}
        >
          {activeTabData ? (
            <>
              <span>{activeTabData.language}</span>
              <span>·</span>
              <span>UTF-8</span>
              <span>·</span>
              <span>{activeTabData.content.split("\n").length} 行</span>
              {activeTabData.modified && (
                <>
                  <span>·</span>
                  <span style={{ color: "var(--accent-primary)" }}>未保存</span>
                </>
              )}
            </>
          ) : (
            <span>{workspaceRoot ?? "未打开工作区"}</span>
          )}
          {/* 断点状态指示 */}
          {isWaitingBreakpoint && (
            <span className="ml-auto flex items-center gap-1" style={{ color: "#f59e0b" }}>
              <Loader2 size={10} className="animate-spin" />
              等待断点...
            </span>
          )}
          {debugSnapshot && !isWaitingBreakpoint && (
            <span className="ml-auto flex items-center gap-1" style={{ color: "#ef4444" }}>
              <Circle size={7} className="fill-current" />
              断点已命中
            </span>
          )}
        </div>
      </div>

      {/* ══ 右栏：Agent 对话区 + 断点面板 ════════════════════════════════════ */}
      <div
        className="flex w-80 flex-shrink-0 flex-col border-l"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-secondary)" }}
      >
        {/* 顶部：模型选择 */}
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Bot size={14} style={{ color: "var(--accent-primary)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
            Agent
          </span>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            disabled={modelsLoading}
            className="ml-auto max-w-[140px] truncate rounded border px-1.5 py-1 text-xs outline-none"
            style={{
              background: "var(--bg-primary)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            {modelsLoading && <option>加载中...</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!modelsLoading && models.length === 0 && (
              <option disabled>请先配置 API Key</option>
            )}
          </select>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {chatMessages.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8">
              <Wrench size={24} style={{ color: "var(--text-muted)" }} />
              <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
                告诉 Agent 你想做什么
              </p>
              {/* 快捷提示 */}
              {activeTabData && (
                <div className="mt-2 flex flex-col gap-1.5 w-full">
                  {[
                    `分析 ${activeTabData.name} 的代码结构`,
                    `帮我优化 ${activeTabData.name}`,
                    `列出工作区所有文件`,
                  ].map((hint) => (
                    <button
                      key={hint}
                      onClick={() => setInputText(hint)}
                      className="rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)]"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              )}
              {/* 调试快捷提示 */}
              {!activeTabData && (
                <div className="mt-2 flex flex-col gap-1.5 w-full">
                  {[
                    "获取最新断点快照",
                    "分析断点处的变量状态",
                  ].map((hint) => (
                    <button
                      key={hint}
                      onClick={() => setInputText(hint)}
                      className="rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)]"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {chatMessages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div
                    className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-xs"
                    style={{ background: "var(--accent-primary)", color: "#fff" }}
                  >
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {/* 工具调用卡片 */}
                  {msg.toolCalls?.map((call, i) => (
                    <ToolCallCard key={i} call={call} />
                  ))}
                  {/* 回复文字 */}
                  {msg.content && (
                    <div
                      className="rounded-2xl rounded-tl-sm px-3 py-2 text-xs"
                      style={{
                        background: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg.content}
                    </div>
                  )}
                  {/* 流式中的光标 */}
                  {streaming && msg.id === currentAssistantIdRef.current && !msg.content && (
                    <div
                      className="h-4 w-1 animate-pulse rounded"
                      style={{ background: "var(--accent-primary)" }}
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>

        {/* 输入区 */}
        <div
          className="border-t p-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div
            className="flex items-end gap-2 rounded-xl border px-3 py-2"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--bg-primary)",
            }}
          >
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                !workspaceRoot
                  ? "先打开工作区..."
                  : models.length === 0
                  ? "请先配置 API Key..."
                  : "告诉 Agent 你想做什么... (Enter 发送)"
              }
              disabled={models.length === 0}
              rows={1}
              className="flex-1 resize-none bg-transparent text-xs outline-none disabled:opacity-50"
              style={{
                color: "var(--text-primary)",
                maxHeight: "120px",
                overflowY: "auto",
              }}
            />
            <button
              onClick={streaming ? abort : handleSend}
              disabled={models.length === 0 || (!streaming && !inputText.trim())}
              className="flex-shrink-0 rounded-lg p-1.5 transition-colors disabled:opacity-40"
              style={{
                background: streaming ? "#ef4444" : "var(--accent-primary)",
                color: "#fff",
              }}
            >
              {streaming ? <Square size={13} /> : <Send size={13} />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Agent 可读写工作区文件 · 辅助断点调试
          </p>
        </div>

        {/* ── 断点面板 ── */}
        <DebugPanel
          snapshot={debugSnapshot}
          isWaiting={isWaitingBreakpoint}
          onRefresh={fetchDebugSnapshot}
        />
      </div>
    </div>
  );
}
