/**
 * SQLite 单例初始化
 * 使用 sql.js（WASM），数据持久化到 localStorage（base64）
 * 后续可无缝替换为后端 API 实现
 */

import type { Database, SqlJsStatic } from "sql.js";

const DB_STORAGE_KEY = "cor_aiworker_db";

let _sqlJs: SqlJsStatic | null = null;
let _db: Database | null = null;
let _initPromise: Promise<Database> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (_sqlJs) return _sqlJs;
  const initSqlJs = (await import("sql.js")).default;
  _sqlJs = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  return _sqlJs;
}

/** 从 localStorage 恢复或新建数据库 */
export async function getDb(): Promise<Database> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const SQL = await loadSqlJs();

    const saved = localStorage.getItem(DB_STORAGE_KEY);
    if (saved) {
      const buf = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
      _db = new SQL.Database(buf);
    } else {
      _db = new SQL.Database();
    }

    // 建表（幂等）
    _db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id          TEXT PRIMARY KEY,
        provider    TEXT NOT NULL,
        label       TEXT NOT NULL,
        key_value   TEXT NOT NULL,
        model_name  TEXT,
        base_url    TEXT,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `);

    // 迁移：为已有表补充 model_name 列（幂等，列已存在时忽略错误）
    try {
      _db.run(`ALTER TABLE api_keys ADD COLUMN model_name TEXT;`);
    } catch {
      // 列已存在，忽略
    }

    persistDb(_db);
    return _db;
  })();

  return _initPromise;
}

/** 将当前数据库状态持久化到 localStorage */
export function persistDb(db: Database) {
  const data = db.export();
  const b64 = btoa(String.fromCharCode(...data));
  localStorage.setItem(DB_STORAGE_KEY, b64);
}
