"use client";

/**
 * IndexedDB 初始化
 * 使用 idb 库封装，提供类型安全的数据库访问
 *
 * Store 设计：
 *   conversations  - 会话元信息（标题、模型、时间等）
 *   messages       - 消息记录（按 conversationId 索引）
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// ── Schema 类型定义 ──
export interface ConversationRow {
  id: string;
  title: string;        // 第一条用户消息前 30 字，或"新对话"
  modelLabel: string;   // 显示用模型名
  modelKeyId: string;   // ApiKeyRecord.id，便于后续恢复模型选择
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
  };
  createdAt: number;    // timestamp ms，排序用
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
}

const DB_NAME    = "cor-aiworker";
const DB_VERSION = 1;

let _db: IDBPDatabase<CordSchema> | null = null;

export async function getIdb(): Promise<IDBPDatabase<CordSchema>> {
  if (_db) return _db;

  _db = await openDB<CordSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
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
    },
  });

  return _db;
}
