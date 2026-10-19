import { useEffect, useState } from "react";

import { ApiError, api } from "./api/client";
import type { Session } from "./api/types";
import styles from "./App.module.css";
import { Logo } from "./components/Logo";

type Connection =
  | { state: "checking" }
  | { state: "online"; sessions: Session[] }
  | { state: "error"; message: string };

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "unauthorized") {
      return "页面缺少访问令牌。请通过 cor-aiworker serve 输出的地址打开界面。";
    }
    return error.message;
  }
  return "连接不到本地服务。请在终端运行 cor-aiworker serve。";
}

export function App() {
  const [connection, setConnection] = useState<Connection>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    api
      .sessions()
      .then((sessions) => !cancelled && setConnection({ state: "online", sessions }))
      .catch((error: unknown) => !cancelled && setConnection({ state: "error", message: describe(error) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const statusText = {
    checking: "正在连接本地服务…",
    online: "本地服务已连接",
    error: "本地服务未连接",
  }[connection.state];

  return (
    <div className={styles.app}>
      <aside className={styles.side}>
        <div className={styles.brand}>
          <span className={styles.brandRow}>
            <Logo className={styles.logo} />
            <b>Cor-AiWorker</b>
          </span>
          <span className={styles.status} data-state={connection.state}>
            <span className={styles.dot} />
            {statusText}
          </span>
        </div>
        <nav className={styles.sessions} aria-label="会话列表">
          {connection.state === "online" &&
            (connection.sessions.length ? (
              connection.sessions.map((s) => (
                <div key={s.id} className={styles.session}>
                  <span className={styles.sessionTitle}>{s.title || "新对话"}</span>
                  <span className={styles.sessionMeta}>
                    {s.provider} · {s.model}
                  </span>
                </div>
              ))
            ) : (
              <p className={styles.hint}>还没有会话</p>
            ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.empty}>
          <Logo size={56} className={styles.emptyLogo} />
          {connection.state === "error" ? (
            <>
              <h1>本地服务未连接</h1>
              <p className={styles.error}>{connection.message}</p>
            </>
          ) : (
            <>
              <h1>Cor-AiWorker</h1>
              <p>界面开发中：对话功能将在下一步（M3-2）完成。</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
