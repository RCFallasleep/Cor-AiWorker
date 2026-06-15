/**
 * Agent Mock 数据（已清空）
 * Mock 数据已移除，Agent 数据通过 IndexedDB 持久化存储。
 * 新建 Agent 请使用页面右上角「新建 Agent」按钮。
 */

import type { AgentRow } from "@/lib/db/idb";

export const MOCK_AGENTS: Omit<AgentRow, "id" | "createdAt" | "updatedAt">[] = [];
