"use client";

/**
 * Conversation Repository
 * 接口定义 + IndexedDB 实现
 * 后续切换后端 API 时只需换一个实现类
 */

import { getIdb, type ConversationRow, type MessageRow } from "@/lib/db/idb";

// ── 重新导出类型，方便外部使用 ──
export type { ConversationRow, MessageRow };

// ── 输入类型 ──
export interface CreateConversationInput {
  title: string;
  modelLabel: string;
  modelKeyId: string;
}

export interface AppendMessageInput {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  meta?: MessageRow["meta"];
}

// ── 接口定义（便于后续替换实现）──
export interface IConversationRepository {
  /** 获取所有会话，按最后活跃时间倒序 */
  listConversations(): Promise<ConversationRow[]>;
  /** 获取单个会话 */
  getConversation(id: string): Promise<ConversationRow | undefined>;
  /** 新建会话 */
  createConversation(input: CreateConversationInput): Promise<ConversationRow>;
  /** 更新会话元信息（标题、预览、消息数等） */
  updateConversation(id: string, patch: Partial<Omit<ConversationRow, "id" | "createdAt">>): Promise<void>;
  /** 删除会话及其所有消息 */
  deleteConversation(id: string): Promise<void>;
  /** 获取会话的所有消息，按时间正序 */
  getMessages(conversationId: string): Promise<MessageRow[]>;
  /** 追加一条消息，并同步更新会话的 updatedAt / lastPreview / messageCount */
  appendMessage(input: AppendMessageInput): Promise<MessageRow>;
  /** 更新某条消息（流式结束后补写 meta） */
  updateMessage(id: string, patch: Partial<Pick<MessageRow, "content" | "meta">>): Promise<void>;
}

// ── 工具函数 ──
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "…" : str;
}

// ── IndexedDB 实现 ──
export class IdbConversationRepository implements IConversationRepository {

  async listConversations(): Promise<ConversationRow[]> {
    const db = await getIdb();
    // 按 updatedAt 倒序
    const all = await db.getAllFromIndex("conversations", "by-updatedAt");
    return all.reverse();
  }

  async getConversation(id: string): Promise<ConversationRow | undefined> {
    const db = await getIdb();
    return db.get("conversations", id);
  }

  async createConversation(input: CreateConversationInput): Promise<ConversationRow> {
    const db  = await getIdb();
    const now = Date.now();
    const row: ConversationRow = {
      id:           generateId("conv"),
      title:        input.title,
      modelLabel:   input.modelLabel,
      modelKeyId:   input.modelKeyId,
      messageCount: 0,
      lastPreview:  "",
      createdAt:    now,
      updatedAt:    now,
    };
    await db.put("conversations", row);
    return row;
  }

  async updateConversation(
    id: string,
    patch: Partial<Omit<ConversationRow, "id" | "createdAt">>
  ): Promise<void> {
    const db       = await getIdb();
    const existing = await db.get("conversations", id);
    if (!existing) return;
    await db.put("conversations", { ...existing, ...patch });
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await getIdb();

    // 删除所有消息
    const msgs = await db.getAllFromIndex("messages", "by-conversationId", id);
    const tx   = db.transaction("messages", "readwrite");
    await Promise.all(msgs.map((m) => tx.store.delete(m.id)));
    await tx.done;

    // 删除会话
    await db.delete("conversations", id);
  }

  async getMessages(conversationId: string): Promise<MessageRow[]> {
    const db   = await getIdb();
    const msgs = await db.getAllFromIndex("messages", "by-conversationId", conversationId);
    // 按 createdAt 正序
    return msgs.sort((a, b) => a.createdAt - b.createdAt);
  }

  async appendMessage(input: AppendMessageInput): Promise<MessageRow> {
    const db  = await getIdb();
    const now = Date.now();

    const row: MessageRow = {
      id:             generateId("msg"),
      conversationId: input.conversationId,
      role:           input.role,
      content:        input.content,
      timestamp:      input.timestamp,
      meta:           input.meta,
      createdAt:      now,
    };
    await db.put("messages", row);

    // 同步更新会话元信息
    const conv = await db.get("conversations", input.conversationId);
    if (conv) {
      await db.put("conversations", {
        ...conv,
        messageCount: conv.messageCount + 1,
        lastPreview:  truncate(input.content.replace(/\s+/g, " "), 40),
        updatedAt:    now,
      });
    }

    return row;
  }

  async updateMessage(
    id: string,
    patch: Partial<Pick<MessageRow, "content" | "meta">>
  ): Promise<void> {
    const db       = await getIdb();
    const existing = await db.get("messages", id);
    if (!existing) return;
    await db.put("messages", { ...existing, ...patch });

    // 如果是 assistant 消息，同步更新会话预览
    if (existing.role === "assistant" && patch.content !== undefined) {
      const conv = await db.get("conversations", existing.conversationId);
      if (conv) {
        await db.put("conversations", {
          ...conv,
          lastPreview: truncate(patch.content.replace(/\s+/g, " "), 40),
          updatedAt:   Date.now(),
        });
      }
    }
  }
}

// ── 单例导出 ──
export const conversationRepo = new IdbConversationRepository();
