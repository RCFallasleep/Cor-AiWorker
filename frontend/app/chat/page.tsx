"use client";

import { useState, useCallback, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatToolbar } from "@/components/chat/chat-toolbar";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { useChatStream, type AgentEvent, type Attachment } from "@/lib/hooks/use-chat-stream";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useClientContext } from "@/lib/hooks/use-client-context";
import { useEnabledSkillTools } from "@/lib/hooks/use-enabled-skill-tools";
import { useAuth } from "@/contexts/auth-context";
import { conversationRepo } from "@/lib/repositories/conversation-repository";
import { agentRepo } from "@/lib/repositories/agent-repository";
import { type ChatMessage, type AgentStep } from "@/lib/mock-chat-data";
import type { AvailableModel } from "@/lib/hooks/use-available-models";
import type { AgentRow, ConversationRow } from "@/lib/db/idb";

/** 后端地址（与 useChatStream 保持一致） */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

async function generateTitle(model: AvailableModel, userMessage: string): Promise<string> {
  try {
    const endpoint = BACKEND_URL ? `${BACKEND_URL}/v1/chat` : "/api/chat";
    const body = BACKEND_URL
      ? JSON.stringify({
          messages: [{ role: "user", content: `请将以下对话内容总结为一个简短的标题，要求：8个字以内，不加引号，不加标点，直接输出标题文字。\n\n对话内容：${userMessage}` }],
          model:    model.apiName,
          api_key:  model.keyValue,
          base_url: model.baseUrl ?? null,
        })
      : JSON.stringify({
          messages: [{ role: "user", content: `请将以下对话内容总结为一个简短的标题，要求：8个字以内，不加引号，不加标点，直接输出标题文字。\n\n对话内容：${userMessage}` }],
          model:   model.apiName,
          apiKey:  model.keyValue,
          baseUrl: model.baseUrl,
        });

    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!res.ok || !res.body) return "";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let title = "", buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try { const ev = JSON.parse(line.slice(6)); if (ev.type === "delta") title += ev.content; } catch { /* 忽略 */ }
      }
    }
    return title.replace(/["""《》「」『』]/g, "").trim().slice(0, 20) || "";
  } catch { return ""; }
}

function nowTimestamp() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const LAST_AGENT_KEY = "cor_last_agent_id";
const LAST_CONV_KEY  = "cor_last_conv_id";

function ChatPageInner() {
  const searchParams = useSearchParams();
  const urlConvId = searchParams.get("id");

  // 当前选中的 Agent（null 表示未选择）
  const [currentAgent, setCurrentAgent] = useState<AgentRow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // ── 上下文占用追踪（Phase 8.6）──
  // 累计输入 token 数（跨轮次累加，每次 onDone 更新）
  const [totalInputTokens, setTotalInputTokens] = useState(0);
  // 当前模型的上下文窗口大小（从 done 事件获取）
  const [contextLimit, setContextLimit] = useState(128000);
  // 是否正在压缩（显示 compressing 状态）
  const [isCompressing, setIsCompressing] = useState(false);

  // ── 工具调用次数上限（Phase 8.7）──
  // 当前触发 loop_limit 的累计轮次数（null 表示未触发）
  // 用户每次点击「继续执行」后清空，下次触发时重新记录
  const [loopLimitCount, setLoopLimitCount] = useState<number | null>(null);
  // 用户已点击「继续执行」的次数（决定下次 maxLoopOverride = (continueTimes+1)*10 + 初始10）
  const continueTimesRef = useRef(0);

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const urlLoadedRef = useRef(false);

  // 从 API Key 列表中，根据 Agent 绑定的模型名找到对应的 AvailableModel
  const { models, loading: modelsLoading } = useAvailableModels();
  // 从 Skill 中心拉取已启用的工具名白名单（排除协作专用工具）
  const { toolNames } = useEnabledSkillTools();
  // 当前登录用户（供 scheduler 等工具注入 user_id）
  const { user } = useAuth();
  const currentModel: AvailableModel | undefined = currentAgent
    ? (models.find((m) => m.label === currentAgent.model || m.apiName === currentAgent.model) ?? models[0])
    : undefined;
  const supportsVision = currentModel?.supportsVision ?? false;

  // 初始化时恢复上次选择的 Agent
  useEffect(() => {
    const savedId = localStorage.getItem(LAST_AGENT_KEY);
    if (!savedId) return;
    agentRepo.get(savedId).then((agent) => {
      if (agent) setCurrentAgent(agent);
    });
  }, []);

  // 初始化时恢复上次的对话（仅在 URL 没有指定 id 时生效）
  useEffect(() => {
    if (urlConvId) return; // URL 已指定对话，优先使用
    const savedConvId = localStorage.getItem(LAST_CONV_KEY);
    if (!savedConvId) return;
    conversationRepo.getMessages(savedConvId).then((rows) => {
      if (rows.length === 0) {
        // 对话已被删除或为空，清除记录
        localStorage.removeItem(LAST_CONV_KEY);
        return;
      }
      setCurrentConvId(savedConvId);
      conversationIdRef.current = savedConvId;
      setMessages(rows.map(rowToMessage));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { streaming, sendMessage, abort } = useChatStream();
  const clientContext = useClientContext();

  // ── 当前 AI 占位消息 ID（供 Agent 事件回调更新 agentSteps）──
  const currentAiMsgIdRef = useRef<string | null>(null);
  // ── 当前轮次的思考文字缓冲（累积后写入最新 step 的 thinkingText）──
  const thinkingBufRef = useRef<string>("");
  // ── 当前 AI 消息的 agentSteps 实时镜像（供 onDone 读取最终值）──
  const agentStepsRef = useRef<AgentStep[]>([]);

  /** MessageRow → ChatMessage，恢复 agentSteps */
  const rowToMessage = useCallback((r: { id: string; role: string; content: string; timestamp?: string; meta?: { agentSteps?: AgentStep[]; [k: string]: unknown } }): ChatMessage => ({
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    timestamp: r.timestamp ?? "",
    username: r.role === "user" ? "You" : undefined,
    meta: r.meta as ChatMessage["meta"],
    // 从 meta 里恢复 agentSteps（持久化时存在 meta.agentSteps）
    agentSteps: r.meta?.agentSteps ?? undefined,
  }), []);

  const handleConversationChange = useCallback(async (id: string | null) => {
    setErrorBanner(null);
    setCurrentConvId(id);
    conversationIdRef.current = id;
    // 持久化当前对话 id
    if (id) localStorage.setItem(LAST_CONV_KEY, id);
    else localStorage.removeItem(LAST_CONV_KEY);
    if (!id) { setMessages([]); return; }

    // 并行加载消息 + 对话元数据
    const [rows, conv] = await Promise.all([
      conversationRepo.getMessages(id),
      conversationRepo.getConversation(id),
    ]);
    setMessages(rows.map(rowToMessage));

    // 自动切换到该对话关联的 Agent
    if (conv?.agentId) {
      const agent = await agentRepo.get(conv.agentId);
      if (agent) {
        setCurrentAgent(agent);
        localStorage.setItem(LAST_AGENT_KEY, agent.id);
      }
    }
  }, [rowToMessage]);

  const refreshConversations = useCallback(async () => {
    const list = await conversationRepo.listConversations();
    setConversations(list);
    if (urlConvId && !urlLoadedRef.current) {
      const target = list.find((c) => c.id === urlConvId);
      if (target) {
        urlLoadedRef.current = true;
        setCurrentConvId(urlConvId);
        conversationIdRef.current = urlConvId;
        localStorage.setItem(LAST_CONV_KEY, urlConvId);
        const rows = await conversationRepo.getMessages(urlConvId);
        setMessages(rows.map(rowToMessage));
        // 自动切换到该对话关联的 Agent
        if (target.agentId) {
          const agent = await agentRepo.get(target.agentId);
          if (agent) {
            setCurrentAgent(agent);
            localStorage.setItem(LAST_AGENT_KEY, agent.id);
          }
        }
      }
    }
  }, [urlConvId, rowToMessage]);

  useEffect(() => {
    refreshConversations();
    window.addEventListener("conversation-updated", refreshConversations);
    return () => window.removeEventListener("conversation-updated", refreshConversations);
  }, [refreshConversations]);

  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setErrorBanner(null);
    setCurrentConvId(null);
    conversationIdRef.current = null;
    currentAiMsgIdRef.current = null;
    thinkingBufRef.current = "";
    agentStepsRef.current = [];
    // 新对话时重置上下文追踪
    setTotalInputTokens(0);
    setContextLimit(128000);
    setIsCompressing(false);
    // 新对话时重置 loop_limit 状态
    setLoopLimitCount(null);
    continueTimesRef.current = 0;
    // 新对话时清除持久化的对话 id，保留 Agent 选择
    localStorage.removeItem(LAST_CONV_KEY);
  }, []);

  // ── 更新当前 AI 消息的 agentSteps（不可变更新，同步镜像到 ref）──
  const updateAgentSteps = useCallback(
    (updater: (prev: AgentStep[]) => AgentStep[]) => {
      const msgId = currentAiMsgIdRef.current;
      if (!msgId) return;
      const next = updater(agentStepsRef.current);
      agentStepsRef.current = next;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, agentSteps: next } : m
        )
      );
    },
    []
  );

  const handleSend = useCallback(
    async (content: string, attachments: Attachment[] = []) => {
      if ((!content.trim() && attachments.length === 0) || streaming || !currentModel) return;
      setErrorBanner(null);
      thinkingBufRef.current = "";

      const timestamp = nowTimestamp();

      const isFirstMessage = !conversationIdRef.current;
      if (isFirstMessage) {
        const conv = await conversationRepo.createConversation({
          title: content.slice(0, 30) || (attachments.length > 0 ? "图片消息" : "新对话"),
          modelLabel: currentModel.label,
          modelKeyId: currentModel.id,
          agentId:    currentAgent?.id,
          agentName:  currentAgent?.name,
        });
        conversationIdRef.current = conv.id;
        setCurrentConvId(conv.id);
        localStorage.setItem(LAST_CONV_KEY, conv.id);
        window.dispatchEvent(new CustomEvent("conversation-updated"));
      }
      const convId = conversationIdRef.current!;

      // 图片附件的 base64 preview 列表（存入 meta 供渲染）
      const imagePreviews = attachments
        .filter((a) => a.type === "image")
        .map((a) => a.preview);

      const savedUserMsg = await conversationRepo.appendMessage({
        conversationId: convId, role: "user", content, timestamp,
        meta: imagePreviews.length > 0 ? { imagePreviews } : undefined,
      });

      const userMsg: ChatMessage = {
        id: savedUserMsg.id, role: "user", content, timestamp, username: "You",
        meta: imagePreviews.length > 0 ? { imagePreviews } : undefined,
      };

      const assistantPlaceholderId = `msg-ai-${Date.now()}`;
      currentAiMsgIdRef.current = assistantPlaceholderId;
      agentStepsRef.current = []; // 重置 agentSteps 镜像

      const assistantMsg: ChatMessage = {
        id: assistantPlaceholderId, role: "assistant", content: "", timestamp,
        meta: { model: currentModel.label, inputTokens: 0, outputTokens: 0, ctxPercent: 0 },
        agentSteps: [],
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      let streamedContent = "";

      await sendMessage(
        currentModel,
        messages,
        content,
        // onDelta：最终回复文字增量
        (delta) => {
          streamedContent += delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantPlaceholderId ? { ...m, content: m.content + delta } : m
            )
          );
        },
        // onDone：流式结束，把 agentSteps 一起存入 DB
        async (inputTokens, outputTokens, newContextLimit) => {
          // 累计 input tokens（跨轮次）
          setTotalInputTokens((prev) => {
            const next = prev + inputTokens;
            return next;
          });
          if (newContextLimit) setContextLimit(newContextLimit);
          setIsCompressing(false);
          // 注意：loopLimitCount 由 onAgentEvent 的 loop_limit 事件设置，onDone 不清除

          // 从 ref 直接读取最终 agentSteps（同步可靠）
          const finalAgentSteps = agentStepsRef.current.length > 0
            ? agentStepsRef.current
            : undefined;

          // 计算真实上下文占用百分比
          const limit = newContextLimit ?? contextLimit;
          const ctxPercent = limit > 0 ? Math.round((totalInputTokens + inputTokens) / limit * 100) : 0;

          const meta = {
            model: currentModel.label, inputTokens, outputTokens,
            wordCount: streamedContent.replace(/\s+/g, " ").split(" ").length,
            ctxPercent,
            // agentSteps 持久化到 meta，切换会话时可恢复
            ...(finalAgentSteps ? { agentSteps: finalAgentSteps } : {}),
          };
          setMessages((prev) =>
            prev.map((m) => m.id === assistantPlaceholderId ? { ...m, meta } : m)
          );
          const savedAssistant = await conversationRepo.appendMessage({
            conversationId: convId, role: "assistant",
            content: streamedContent, timestamp, meta,
          });
          setMessages((prev) =>
            prev.map((m) => m.id === assistantPlaceholderId ? { ...m, id: savedAssistant.id } : m)
          );
          if (isFirstMessage) {
            generateTitle(currentModel, content).then((title) => {
              if (title) conversationRepo.updateConversation(convId, { title }).then(() =>
                window.dispatchEvent(new CustomEvent("conversation-updated"))
              );
            });
          }
        },
        // onError
        (errMsg) => {
          setErrorBanner(errMsg);
          setMessages((prev) => prev.filter((m) => m.id !== assistantPlaceholderId));
        },
        // onAgentEvent：tool_call / tool_result / compressing / compress_done / loop_limit
        (event: AgentEvent) => {
          if (event.type === "loop_limit") {
            // 工具调用达到上限，显示「继续执行」提示条
            setLoopLimitCount(event.loop_count);
            return;
          }
          if (event.type === "tool_call") {
            const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const thinkingText = thinkingBufRef.current.trim().slice(0, 80) || undefined;
            thinkingBufRef.current = "";
            updateAgentSteps((prev) => [
              ...prev,
              {
                id: stepId,
                name: event.name,
                args: event.args,
                status: "running",
                thinkingText,
              } satisfies AgentStep,
            ]);
          } else if (event.type === "tool_result") {
            updateAgentSteps((prev) => {
              const idx = [...prev].reverse().findIndex(
                (s) => s.name === event.name && s.status === "running"
              );
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              return prev.map((s, i) =>
                i === realIdx ? { ...s, status: "done" } : s
              );
            });
          } else if (event.type === "compressing") {
            // 压缩开始：在 agentSteps 中插入一个 compressing 节点
            setIsCompressing(true);
            const stepId = `compress-${Date.now()}`;
            updateAgentSteps((prev) => [
              ...prev,
              {
                id: stepId,
                name: "__compressing__",
                args: { message: event.message },
                status: "running",
              } satisfies AgentStep,
            ]);
          } else if (event.type === "compress_done") {
            // 压缩完成：更新 compressing 节点为 done，携带压缩详情
            setIsCompressing(false);
            if (event.freed_tokens > 0) {
              setTotalInputTokens((prev) => Math.max(0, prev - event.freed_tokens));
            }
            updateAgentSteps((prev) => {
              const idx = [...prev].reverse().findIndex(
                (s) => s.name === "__compressing__" && s.status === "running"
              );
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              return prev.map((s, i) =>
                i === realIdx
                  ? {
                      ...s,
                      status: "done",
                      args: {
                        ...s.args,
                        freed_tokens: event.freed_tokens,
                        message: event.message,
                        compressed_messages: event.compressed_messages,
                      },
                    }
                  : s
              );
            });
          }
        },
        // onThinkingDelta：中间轮次思考文字，累积到 buffer
        (delta) => {
          thinkingBufRef.current += delta;
        },
        true,                              // agentMode
        clientContext,
        convId,                            // sessionId → 后端日志关联
        currentAgent?.systemPrompt || undefined,  // Agent system prompt
        attachments,                       // 图片附件
        toolNames,                         // Skill 中心工具白名单（排除协作专用工具）
        user?.id ?? null,                  // user_id（供 scheduler 等工具注入）
        user?.id ?? null,                  // agent_self_id（暂时与 user_id 相同）
        false,                             // compressOnly
        null,                              // maxLoopOverride（普通发送时不覆盖）
      );
    },
    [messages, currentModel, currentAgent, sendMessage, streaming, clientContext, updateAgentSteps, toolNames, user, contextLimit, totalInputTokens]
  );

  // ── 继续执行回调（用户点击「继续执行」后触发）──
  const handleContinueLoop = useCallback(async () => {
    if (!currentModel || streaming) return;
    continueTimesRef.current += 1;
    // 每次继续 +10 轮：第1次=20，第2次=30，以此类推
    const maxLoopOverride = (continueTimesRef.current + 1) * 10;
    setLoopLimitCount(null); // 清除提示条，开始执行

    // 重用当前 AI 消息（不新建），继续追加 agentSteps
    // 注意：不新建 userMsg，直接用当前 messages 继续
    await sendMessage(
      currentModel,
      messages,
      "",                    // 空 userContent（继续执行不需要新用户消息）
      // onDelta：继续追加到最后一条 assistant 消息
      (delta) => {
        setMessages((prev) => {
          const lastAi = [...prev].reverse().find((m) => m.role === "assistant");
          if (!lastAi) return prev;
          return prev.map((m) => m.id === lastAi.id ? { ...m, content: m.content + delta } : m);
        });
      },
      // onDone
      async (inputTokens, outputTokens, newContextLimit) => {
        setTotalInputTokens((prev) => prev + inputTokens);
        if (newContextLimit) setContextLimit(newContextLimit);
        setIsCompressing(false);
      },
      // onError
      (errMsg) => { setErrorBanner(errMsg); },
      // onAgentEvent
      (event: AgentEvent) => {
        if (event.type === "loop_limit") {
          setLoopLimitCount(event.loop_count);
          return;
        }
        if (event.type === "tool_call") {
          const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const thinkingText = thinkingBufRef.current.trim().slice(0, 80) || undefined;
          thinkingBufRef.current = "";
          updateAgentSteps((prev) => [
            ...prev,
            { id: stepId, name: event.name, args: event.args, status: "running", thinkingText } satisfies AgentStep,
          ]);
        } else if (event.type === "tool_result") {
          updateAgentSteps((prev) => {
            const idx = [...prev].reverse().findIndex((s) => s.name === event.name && s.status === "running");
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            return prev.map((s, i) => i === realIdx ? { ...s, status: "done" } : s);
          });
        } else if (event.type === "compressing") {
          setIsCompressing(true);
          const stepId = `compress-${Date.now()}`;
          updateAgentSteps((prev) => [
            ...prev,
            { id: stepId, name: "__compressing__", args: { message: event.message }, status: "running" } satisfies AgentStep,
          ]);
        } else if (event.type === "compress_done") {
          setIsCompressing(false);
          if (event.freed_tokens > 0) setTotalInputTokens((prev) => Math.max(0, prev - event.freed_tokens));
          updateAgentSteps((prev) => {
            const idx = [...prev].reverse().findIndex((s) => s.name === "__compressing__" && s.status === "running");
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            return prev.map((s, i) =>
              i === realIdx ? { ...s, status: "done", args: { ...s.args, freed_tokens: event.freed_tokens, message: event.message, compressed_messages: event.compressed_messages } } : s
            );
          });
        }
      },
      // onThinkingDelta
      (delta) => { thinkingBufRef.current += delta; },
      true,                              // agentMode
      clientContext,
      conversationIdRef.current,
      currentAgent?.systemPrompt || undefined,
      [],                                // attachments
      toolNames,
      user?.id ?? null,
      user?.id ?? null,
      false,                             // compressOnly
      maxLoopOverride,                   // ← 关键：覆盖最大循环次数
    );
  }, [currentModel, streaming, messages, sendMessage, clientContext, currentAgent, toolNames, user, updateAgentSteps]);

  // ── 手动压缩回调 ──
  const handleManualCompress = useCallback(async () => {
    if (!currentModel || streaming || isCompressing) return;
    // 构造一个只含历史消息的 compress_only 请求
    // 用一个空的 userContent，让 buildRequestBody 只传历史
    const assistantPlaceholderId = `msg-compress-${Date.now()}`;
    currentAiMsgIdRef.current = assistantPlaceholderId;
    agentStepsRef.current = [];

    const timestamp = nowTimestamp();
    const compressMsg: ChatMessage = {
      id: assistantPlaceholderId,
      role: "assistant",
      content: "",
      timestamp,
      agentSteps: [],
    };
    setMessages((prev) => [...prev, compressMsg]);

    await sendMessage(
      currentModel,
      messages,
      "",                    // 空 userContent（compress_only 模式不需要）
      () => {},              // onDelta（压缩模式无输出）
      async (inputTokens, _outputTokens, newContextLimit) => {
        if (newContextLimit) setContextLimit(newContextLimit);
        setIsCompressing(false);
        // 移除占位消息
        setMessages((prev) => prev.filter((m) => m.id !== assistantPlaceholderId));
      },
      (errMsg) => {
        setErrorBanner(errMsg);
        setMessages((prev) => prev.filter((m) => m.id !== assistantPlaceholderId));
      },
      (event: AgentEvent) => {
        if (event.type === "compressing") {
          setIsCompressing(true);
          const stepId = `compress-${Date.now()}`;
          updateAgentSteps((prev) => [
            ...prev,
            { id: stepId, name: "__compressing__", args: { message: event.message }, status: "running" } satisfies AgentStep,
          ]);
        } else if (event.type === "compress_done") {
          setIsCompressing(false);
          if (event.freed_tokens > 0) {
            setTotalInputTokens((prev) => Math.max(0, prev - event.freed_tokens));
          }
          updateAgentSteps((prev) => {
            const idx = [...prev].reverse().findIndex(
              (s) => s.name === "__compressing__" && s.status === "running"
            );
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            return prev.map((s, i) =>
              i === realIdx
                ? { ...s, status: "done", args: { ...s.args, freed_tokens: event.freed_tokens, message: event.message, compressed_messages: event.compressed_messages } }
                : s
            );
          });
        }
      },
      undefined,             // onThinkingDelta
      true,                  // agentMode
      clientContext,
      conversationIdRef.current,
      currentAgent?.systemPrompt || undefined,
      [],                    // attachments
      toolNames,
      user?.id ?? null,
      user?.id ?? null,
      true,                  // compressOnly ← 关键
    );
  }, [currentModel, streaming, isCompressing, messages, sendMessage, clientContext, currentAgent, toolNames, user, updateAgentSteps]);

  // 上下文占用百分比（0~100）
  const ctxUsagePercent = contextLimit > 0 ? Math.min(100, Math.round(totalInputTokens / contextLimit * 100)) : 0;

  // ── LoopLimitBanner 组件（内联，避免新建文件）──
  const LoopLimitBanner = loopLimitCount !== null ? (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 20px",
        backgroundColor: "rgba(245,158,11,0.07)",
        borderTop: "1px solid rgba(245,158,11,0.2)",
        borderBottom: "1px solid rgba(245,158,11,0.2)",
      }}
    >
      <span style={{ fontSize: "13px", color: "#fbbf24", flex: 1 }}>
        ⚡ Agent 已完成 <strong>{loopLimitCount}</strong> 次工具调用，是否继续执行？
      </span>
      <button
        onClick={handleContinueLoop}
        disabled={streaming}
        style={{
          flexShrink: 0,
          padding: "5px 14px",
          borderRadius: "6px",
          border: "1px solid rgba(245,158,11,0.4)",
          backgroundColor: "rgba(245,158,11,0.12)",
          color: "#fbbf24",
          fontSize: "12px",
          fontWeight: 600,
          cursor: streaming ? "not-allowed" : "pointer",
          outline: "none",
          whiteSpace: "nowrap",
          opacity: streaming ? 0.5 : 1,
        }}
      >
        继续执行（+10 次）
      </button>
      <button
        onClick={() => setLoopLimitCount(null)}
        style={{
          flexShrink: 0,
          padding: "5px 10px",
          borderRadius: "6px",
          border: "1px solid rgba(255,255,255,0.1)",
          backgroundColor: "transparent",
          color: "var(--text-muted)",
          fontSize: "12px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        停止
      </button>
    </div>
  ) : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--background)",
      }}
    >
      {/* 顶部工具栏 */}
      <ChatToolbar
        conversationId={currentConvId}
        conversations={conversations}
        onConversationChange={handleConversationChange}
        agentId={currentAgent?.id ?? ""}
        onAgentChange={(agent) => {
          setCurrentAgent(agent);
          setErrorBanner(null);
          if (agent) localStorage.setItem(LAST_AGENT_KEY, agent.id);
          else localStorage.removeItem(LAST_AGENT_KEY);
        }}
        streaming={streaming}
        onAbort={abort}
        onNewConversation={handleNewConversation}
        totalInputTokens={totalInputTokens}
        contextLimit={contextLimit}
        ctxUsagePercent={ctxUsagePercent}
        onManualCompress={handleManualCompress}
        isCompressing={isCompressing}
      />

      {/* 错误提示横幅 */}
      {errorBanner && (
        <div
          style={{
            padding: "10px 20px",
            backgroundColor: "rgba(239,68,68,0.1)",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            color: "#ef4444",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          <span>{errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            style={{
              border: "none", backgroundColor: "transparent",
              color: "#ef4444", cursor: "pointer", fontSize: "16px",
              lineHeight: 1, outline: "none", flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* 空状态引导 */}
      {messages.length === 0 && !streaming && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            color: "var(--text-muted)",
          }}
        >
          <img src="/logo.svg" alt="logo" style={{ width: "56px", height: "56px", opacity: 0.4 }} />
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: 0 }}>开始一段新对话</p>
          <p style={{ fontSize: "12px", margin: 0 }}>
            {currentAgent
              ? `${currentAgent.name} · ${currentAgent.model}`
              : modelsLoading
                ? "加载中..."
                : "请选择一个 Agent 开始对话"}
          </p>
        </div>
      )}

      {/* 消息列表 */}
      {messages.length > 0 && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <MessageList
            messages={messages}
            streaming={streaming}
            onRetry={(lang, errorMsg) => {
              // 渲染失败时自动发送修复请求给 Agent
              const langLabels: Record<string, string> = {
                echarts: "ECharts 图表",
                mermaid: "Mermaid 图表",
                svg: "SVG 图形",
                html: "HTML 代码",
              };
              const label = langLabels[lang] ?? lang;
              handleSend(
                `你刚才生成的 ${label} 渲染失败了，错误信息：${errorMsg}。请检查代码并修正后重新输出。`,
                []
              );
            }}
          />
        </div>
      )}

      {/* 工具调用次数上限提示条 */}
      {LoopLimitBanner}

      {/* 底部输入框 */}
      <ChatInput
        onSend={handleSend}
        disabled={streaming || !currentAgent || !currentModel}
        supportsVision={supportsVision}
        ctxUsagePercent={ctxUsagePercent}
        onNewConversation={handleNewConversation}
        placeholder={
          streaming ? "AI 正在回复..." :
          !currentAgent ? "请先选择一个 Agent..." :
          !currentModel ? "Agent 绑定的模型未配置 API Key..." :
          `与 ${currentAgent.name} 对话（Enter 发送）`
        }
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}
