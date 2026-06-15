"use client";

import { getIdb, type AgentRow } from "@/lib/db/idb";

function genId() {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 计算等级：每 5 次任务升一级，最高 20 级 */
export function calcLevel(taskCount: number): number {
  return Math.min(20, Math.max(1, Math.floor(taskCount / 5) + 1));
}

export const agentRepo = {
  async list(): Promise<AgentRow[]> {
    const db = await getIdb();
    const all = await db.getAllFromIndex("agents", "by-updatedAt");
    return all.reverse(); // 最新在前
  },

  async get(id: string): Promise<AgentRow | undefined> {
    const db = await getIdb();
    return db.get("agents", id);
  },

  async create(data: Omit<AgentRow, "id" | "createdAt" | "updatedAt" | "level">): Promise<AgentRow> {
    const db = await getIdb();
    const now = Date.now();
    const row: AgentRow = {
      ...data,
      id: genId(),
      level: calcLevel(data.taskCount),
      createdAt: now,
      updatedAt: now,
    };
    await db.put("agents", row);
    return row;
  },

  async update(id: string, patch: Partial<Omit<AgentRow, "id" | "createdAt">>): Promise<AgentRow | undefined> {
    const db = await getIdb();
    const existing = await db.get("agents", id);
    if (!existing) return undefined;
    const updated: AgentRow = {
      ...existing,
      ...patch,
      level: calcLevel(patch.taskCount ?? existing.taskCount),
      updatedAt: Date.now(),
    };
    await db.put("agents", updated);
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await getIdb();
    await db.delete("agents", id);
  },
};
