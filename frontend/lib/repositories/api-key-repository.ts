/**
 * ApiKey Repository
 * 接口定义 + SQLite 实现
 * 后续切换后端 API 时只需换一个实现类
 */

import { getDb, persistDb } from "@/lib/db/sqlite";

/**
 * 根据 API Key 前缀自动识别协议
 * - sk-ant-* → anthropic（Anthropic 官方 Key 格式）
 * - 其他      → openai（OpenAI 兼容协议，适用于 OpenAI / DeepSeek / 自定义代理等）
 */
export function detectProtocol(keyValue: string): "anthropic" | "openai" {
  return keyValue.trimStart().startsWith("sk-ant-") ? "anthropic" : "openai";
}

// ── 类型定义 ──
export type ProviderType = "openai" | "anthropic" | "bedrock" | "vertex";

export interface ApiKeyRecord {
  id: string;
  provider: ProviderType;  // 协议类型：openai / anthropic / bedrock / vertex
  label: string;           // 等同于 modelName，方便显示
  keyValue: string;        // 实际 API Key
  modelName?: string;      // 调用 API 时使用的模型名，如 "deepseek-v4-flash"
  baseUrl?: string;        // 自定义 Base URL（可选）
  extraHeaders?: Record<string, string>;  // 额外 HTTP Header，用于企业网关自定义认证
  isActive: boolean;
  createdAt: string;       // ISO string
  updatedAt: string;
}

export type CreateApiKeyInput = Omit<ApiKeyRecord, "id" | "createdAt" | "updatedAt">;
export type UpdateApiKeyInput = Partial<Omit<ApiKeyRecord, "id" | "createdAt">>;

// ── 接口定义（便于后续替换实现）──
export interface IApiKeyRepository {
  getAll(): Promise<ApiKeyRecord[]>;
  getById(id: string): Promise<ApiKeyRecord | null>;
  create(input: CreateApiKeyInput): Promise<ApiKeyRecord>;
  update(id: string, input: UpdateApiKeyInput): Promise<ApiKeyRecord | null>;
  delete(id: string): Promise<void>;
}

// ── 工具函数 ──
function generateId(): string {
  return `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToRecord(row: Record<string, unknown>): ApiKeyRecord {
  let extraHeaders: Record<string, string> | undefined;
  const raw = row.extra_headers as string | null;
  if (raw) {
    try { extraHeaders = JSON.parse(raw); } catch { /* 忽略损坏数据 */ }
  }
  return {
    id: row.id as string,
    provider: row.provider as string,
    label: row.label as string,
    keyValue: row.key_value as string,
    modelName: (row.model_name as string) || undefined,
    baseUrl: (row.base_url as string) || undefined,
    extraHeaders,
    isActive: (row.is_active as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ── SQLite 实现 ──
export class SqliteApiKeyRepository implements IApiKeyRepository {
  async getAll(): Promise<ApiKeyRecord[]> {
    const db = await getDb();
    const result = db.exec("SELECT * FROM api_keys ORDER BY created_at DESC");
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return rowToRecord(obj);
    });
  }

  async getById(id: string): Promise<ApiKeyRecord | null> {
    const db = await getDb();
    const result = db.exec("SELECT * FROM api_keys WHERE id = :id", { ":id": id });
    if (!result.length || !result[0].values.length) return null;
    const { columns, values } = result[0];
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = values[0][i]; });
    return rowToRecord(obj);
  }

  async create(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const db = await getDb();
    const now = new Date().toISOString();
    const id = generateId();
    db.run(
      `INSERT INTO api_keys (id, provider, label, key_value, model_name, base_url, extra_headers, is_active, created_at, updated_at)
       VALUES (:id, :provider, :label, :key_value, :model_name, :base_url, :extra_headers, :is_active, :created_at, :updated_at)`,
      {
        ":id": id,
        ":provider": input.provider,
        ":label": input.label,
        ":key_value": input.keyValue,
        ":model_name": input.modelName ?? null,
        ":base_url": input.baseUrl ?? null,
        ":extra_headers": input.extraHeaders ? JSON.stringify(input.extraHeaders) : null,
        ":is_active": input.isActive ? 1 : 0,
        ":created_at": now,
        ":updated_at": now,
      }
    );
    persistDb(db);
    return { ...input, id, createdAt: now, updatedAt: now };
  }

  async update(id: string, input: UpdateApiKeyInput): Promise<ApiKeyRecord | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const db = await getDb();
    const now = new Date().toISOString();
    const merged: ApiKeyRecord = { ...existing, ...input, updatedAt: now };

    db.run(
      `UPDATE api_keys
       SET provider = :provider, label = :label, key_value = :key_value,
           model_name = :model_name, base_url = :base_url,
           extra_headers = :extra_headers,
           is_active = :is_active, updated_at = :updated_at
       WHERE id = :id`,
      {
        ":id": id,
        ":provider": merged.provider,
        ":label": merged.label,
        ":key_value": merged.keyValue,
        ":model_name": merged.modelName ?? null,
        ":base_url": merged.baseUrl ?? null,
        ":extra_headers": merged.extraHeaders ? JSON.stringify(merged.extraHeaders) : null,
        ":is_active": merged.isActive ? 1 : 0,
        ":updated_at": now,
      }
    );
    persistDb(db);
    return merged;
  }

  async delete(id: string): Promise<void> {
    const db = await getDb();
    db.run("DELETE FROM api_keys WHERE id = :id", { ":id": id });
    persistDb(db);
  }
}

// ── 单例导出 ──
export const apiKeyRepo = new SqliteApiKeyRepository();
