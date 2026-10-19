/**
 * 基于 fetch 的 SSE 读取（docs/ARCHITECTURE.md 4.7、4.9）。
 *
 * 浏览器原生 EventSource 无法携带 Authorization 头，所以自行解析 text/event-stream。
 * 运行与连接是解耦的（ADR-004）：网络中断后带上最后收到的序号重连，只补发错过的事件。
 */

import { ApiError, authHeaders, toApiError } from "./client";
import { TERMINAL_EVENTS, type RunEvent, type RunEventPayload } from "./types";

export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

/** 增量解析 text/event-stream：可以按任意位置切分的数据块喂入。 */
export class SseParser {
  private buffer = "";
  private id: string | undefined;
  private event = "";
  private data: string[] = [];

  feed(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    // 行结束符可以是 \r\n、\n 或 \r；末尾的 \r 可能与下一块的 \n 组成一个换行，留到下次处理
    const lines = this.buffer.split(/\r\n|\n|\r(?!$)/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        if (this.data.length) {
          messages.push({ id: this.id, event: this.event || "message", data: this.data.join("\n") });
        }
        this.event = "";
        this.data = [];
        continue;
      }
      if (line.startsWith(":")) continue; // 注释（服务端的心跳）
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") this.data.push(value);
      else if (field === "event") this.event = value;
      else if (field === "id" && !value.includes("\0")) this.id = value;
    }
    return messages;
  }
}

export interface SubscribeOptions {
  /** 从这个序号之后开始接收（续传时使用） */
  after?: number;
  signal?: AbortSignal;
  /** 连续失败多少次后放弃；收到新事件后计数清零 */
  maxRetries?: number;
  /** 测试时可替换 */
  fetchImpl?: typeof fetch;
  retryDelay?: (attempt: number) => number;
}

const defaultDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 8000);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** 订阅一次运行的事件，直到收到运行结束或失败事件。 */
export async function* runEvents(
  runId: string,
  options: SubscribeOptions = {},
): AsyncGenerator<RunEvent> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 5;
  const retryDelay = options.retryDelay ?? defaultDelay;
  let last = options.after ?? 0;
  let failures = 0;

  while (true) {
    try {
      const response = await fetchImpl(
        `/api/runs/${encodeURIComponent(runId)}/events?after=${last}`,
        { headers: { ...authHeaders(), Accept: "text/event-stream" }, signal: options.signal },
      );
      if (!response.ok) throw await toApiError(response); // 业务错误（如运行不存在）不重试
      if (!response.body) throw new Error("响应没有内容");

      const parser = new SseParser();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const message of parser.feed(value)) {
            const seq = Number(message.id);
            if (!Number.isInteger(seq) || seq <= last) continue; // 重连时可能收到重复事件
            const payload = JSON.parse(message.data) as RunEventPayload;
            last = seq;
            failures = 0;
            yield { seq, payload };
            if (TERMINAL_EVENTS.has(payload.type)) return;
          }
        }
      } finally {
        // 调用方中途停止读取（例如切换会话）时关闭连接，避免请求一直挂着
        reader.cancel().catch(() => undefined);
      }
      // 流在运行结束前断开（例如本地服务重启），按网络错误处理
      throw new Error("事件流意外结束");
    } catch (error) {
      if (options.signal?.aborted || error instanceof ApiError) throw error;
      if (++failures > maxRetries) throw error;
      await sleep(retryDelay(failures - 1), options.signal);
    }
  }
}
