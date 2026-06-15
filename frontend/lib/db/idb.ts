"use client";

/**
 * IndexedDB 初始化
 * 使用 idb 库封装，提供类型安全的数据库访问
 *
 * Store 设计：
 *   conversations  - 会话元信息（标题、模型、时间等）
 *   messages       - 消息记录（按 conversationId 索引）
 *   agents         - Agent 配置与能力数据
 *
 * 版本历史：
 *   v1 - 初始版本
 *   v2 - MessageRow.meta 新增 agentSteps 字段（Agent 流程图持久化）
 *   v3 - 新增 agents store（Agent 养成系统）
 *   v4 - ConversationRow 新增 agentId 字段（关联 Agent）
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AgentStep } from "@/lib/mock-chat-data";

// ── Schema 类型定义 ──
export interface ConversationRow {
  id: string;
  title: string;        // 第一条用户消息前 30 字，或"新对话"
  modelLabel: string;   // 显示用模型名
  modelKeyId: string;   // ApiKeyRecord.id，便于后续恢复模型选择
  agentId?: string;     // AgentRow.id，关联的 Agent（可选，无则为纯模型对话）
  agentName?: string;   // Agent 显示名（冗余存储，避免查表）
  messageCount: number;
  lastPreview: string;  // 最后一条消息的前 40 字（列表预览用）
  createdAt: number;    // timestamp ms
  updatedAt: number;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;    // 显示用 HH:mm
  meta?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    wordCount?: number;
    ctxPercent?: number;
    /** Agent 流程图数据，流式结束后持久化，切换会话时恢复 */
    agentSteps?: AgentStep[];
  };
  createdAt: number;    // timestamp ms，排序用
}

// ── Agent 数据结构 ──
export interface AgentSkillScores {
  reasoning: number;    // 推理力  (0-100, 对齐 livebench Reasoning)
  coding: number;       // 代码力  (对齐 livebench Coding)
  research: number;     // 调研力  (对齐 livebench Data Analysis)
  writing: number;      // 写作力  (对齐 livebench Language)
  math: number;         // 数学力  (对齐 livebench Mathematics)
  execution: number;    // 执行速 (对齐 livebench Agentic Coding)
}

export interface AgentRow {
  id: string;
  name: string;
  role: string;           // 角色描述，如"深度调研 · 信息聚合专家"
  workStyle: string;      // 工作风格，如"严谨型"
  model: string;          // 绑定模型，如"GPT-4o"
  systemPrompt: string;
  permissionLevel: number; // 1-5
  tools: string[];         // 已装载工具名称列表
  iconName: string;        // lucide 图标名，如"Search"
  iconColor: string;       // 图标背景色，如"#1e3a5f"
  tags: string[];          // 能力标签
  skillScores: AgentSkillScores;
  // 成长轨迹
  taskCount: number;
  accuracy: number;        // 0-100
  teamCount: number;       // 协作次数
  level: number;           // 1-20，由 taskCount 计算
  knowledgeDocs: { name: string; url: string }[];
  status: "online" | "busy" | "idle";
  createdAt: number;
  updatedAt: number;
}

interface CordSchema extends DBSchema {
  conversations: {
    key: string;
    value: ConversationRow;
    indexes: { "by-updatedAt": number };
  };
  messages: {
    key: string;
    value: MessageRow;
    indexes: { "by-conversationId": string; "by-createdAt": number };
  };
  agents: {
    key: string;
    value: AgentRow;
    indexes: { "by-updatedAt": number };
  };
}

const DB_NAME    = "cor-aiworker";
const DB_VERSION = 4;

let _db: IDBPDatabase<CordSchema> | null = null;

export async function getIdb(): Promise<IDBPDatabase<CordSchema>> {
  if (_db) return _db;

  _db = await openDB<CordSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // conversations store
      if (!db.objectStoreNames.contains("conversations")) {
        const convStore = db.createObjectStore("conversations", { keyPath: "id" });
        convStore.createIndex("by-updatedAt", "updatedAt");
      }

      // messages store
      if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "id" });
        msgStore.createIndex("by-conversationId", "conversationId");
        msgStore.createIndex("by-createdAt", "createdAt");
      }

      // v3: agents store
      if (oldVersion < 3 && !db.objectStoreNames.contains("agents")) {
        const agentStore = db.createObjectStore("agents", { keyPath: "id" });
        agentStore.createIndex("by-updatedAt", "updatedAt");
      }

      // v4: ConversationRow 新增 agentId / agentName（无需 schema 变更，IndexedDB 自动兼容）
      // 仅版本号升级，旧数据 agentId/agentName 为 undefined，视为"纯模型对话"
    },
  });

  return _db;
}
