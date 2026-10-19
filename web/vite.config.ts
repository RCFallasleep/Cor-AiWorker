/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** 与本地服务 config.py 相同的数据目录规则（platformdirs.user_data_dir） */
function dataDir(): string {
  const override = process.env.COR_AIWORKER_DATA_DIR;
  if (override) return override;
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "cor-aiworker");
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "cor-aiworker");
  }
  return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "cor-aiworker");
}

interface ServerInfo {
  url: string;
  token: string;
}

function readServerInfo(): ServerInfo | null {
  try {
    return JSON.parse(readFileSync(join(dataDir(), "server.json"), "utf-8")) as ServerInfo;
  } catch {
    return null; // 本地服务尚未启动
  }
}

/**
 * 开发时把本地服务的访问令牌注入页面，与生产环境（本地服务在返回页面时注入）走同一条代码路径。
 * 每次请求页面时重新读取，本地服务重启后刷新页面即可。
 */
function injectDevToken(): Plugin {
  return {
    name: "cor-aiworker-dev-token",
    apply: "serve",
    transformIndexHtml(html) {
      // 令牌由 secrets.token_urlsafe 生成，只含这些字符；过滤其余字符，防止拼进 HTML 时被注入
      const token = (readServerInfo()?.token ?? "").replace(/[^A-Za-z0-9_-]/g, "");
      return html.replace(
        '<meta name="cor-aiworker-token" content="" />',
        `<meta name="cor-aiworker-token" content="${token}" />`,
      );
    },
  };
}

const DEFAULT_SERVER = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react(), injectDevToken()],
  server: {
    // 开发服务器只监听本机；/api 转发给本地服务，浏览器看来与页面同源，无需放开跨域
    host: "127.0.0.1",
    proxy: {
      "/api": { target: readServerInfo()?.url ?? DEFAULT_SERVER, changeOrigin: true },
    },
  },
  test: {
    environment: "node",
  },
});
