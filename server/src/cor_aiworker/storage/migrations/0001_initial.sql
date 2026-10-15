-- 会话：创建时绑定 Provider 与模型（ADR-002）
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX sessions_updated ON sessions (updated_at);

-- 运行：用户发一条消息触发一次运行
CREATE TABLE runs (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    status              TEXT NOT NULL
                        CHECK (status IN ('running', 'finished', 'failed', 'cancelled')),
    user_input          TEXT NOT NULL,
    stop                TEXT,
    error               TEXT,
    turns               INTEGER NOT NULL DEFAULT 0,
    tool_calls          INTEGER NOT NULL DEFAULT 0,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    started_at          TEXT NOT NULL,
    finished_at         TEXT
);
CREATE INDEX runs_session ON runs (session_id, started_at);

-- 会话历史：各协议的原生消息 JSON，原样保存
CREATE TABLE messages (
    session_id  TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    run_id      TEXT REFERENCES runs (id) ON DELETE SET NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
);

-- 运行日志：事件流按序保存，可回放（ADR-003）
CREATE TABLE run_events (
    run_id      TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
);

-- MCP 服务配置；密钥类环境变量只存引用（变量名 → 钥匙串条目名），值在钥匙串里（ADR-007）
CREATE TABLE mcp_servers (
    name        TEXT PRIMARY KEY,
    command     TEXT NOT NULL,
    args        TEXT NOT NULL DEFAULT '[]',
    env_refs    TEXT NOT NULL DEFAULT '{}',
    risk        TEXT NOT NULL CHECK (risk IN ('read', 'network', 'write', 'execute')),
    untrusted   INTEGER NOT NULL DEFAULT 1,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- 按工具覆盖的权限策略
CREATE TABLE tool_policies (
    tool_name   TEXT PRIMARY KEY,
    decision    TEXT NOT NULL CHECK (decision IN ('allow', 'ask', 'deny')),
    updated_at  TEXT NOT NULL
);
