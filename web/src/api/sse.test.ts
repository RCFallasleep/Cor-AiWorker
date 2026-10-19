import { describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { SseParser, runEvents } from "./sse";
import type { RunEvent } from "./types";

const STREAM = [
  ": ping",
  "",
  "event: run_started",
  'data: {"type":"run_started","provider":"deepseek","model":"m"}',
  "id: 1",
  "",
  "event: text_delta",
  'data: {"type":"text_delta","text":"你好"}',
  "id: 2",
  "",
  "",
].join("\n");

describe("SseParser", () => {
  it("parses events and ignores comments", () => {
    const messages = new SseParser().feed(STREAM);
    expect(messages).toEqual([
      { id: "1", event: "run_started", data: '{"type":"run_started","provider":"deepseek","model":"m"}' },
      { id: "2", event: "text_delta", data: '{"type":"text_delta","text":"你好"}' },
    ]);
  });

  it("gives the same result however the stream is split", () => {
    const whole = new SseParser().feed(STREAM);
    const parser = new SseParser();
    const pieces = [...STREAM].flatMap((char) => parser.feed(char));
    expect(pieces).toEqual(whole);
  });

  it("handles CRLF split across chunks and multi-line data", () => {
    const parser = new SseParser();
    const messages = [
      ...parser.feed("data: 第一行\r"),
      ...parser.feed("\ndata: 第二行\r\n\r"),
      ...parser.feed("\n"),
    ];
    expect(messages).toEqual([{ id: undefined, event: "message", data: "第一行\n第二行" }]);
  });
});

// ── runEvents ────────────────────────────────────────────────────────────

function sse(events: Array<[number, Record<string, unknown>]>): string {
  return events
    .map(([seq, payload]) => `event: ${String(payload.type)}\ndata: ${JSON.stringify(payload)}\nid: ${seq}\n\n`)
    .join("");
}

function streamResponse(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // 分成两半发送，模拟网络分块
      controller.enqueue(bytes.slice(0, bytes.length >> 1));
      controller.enqueue(bytes.slice(bytes.length >> 1));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<number[]> {
  const seqs: number[] = [];
  for await (const event of gen) seqs.push(event.seq);
  return seqs;
}

const started = { type: "run_started", provider: "p", model: "m" };
const delta = { type: "text_delta", text: "字" };
const finished = {
  type: "run_finished",
  stop: "end",
  turns: 1,
  tool_calls: 0,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
  elapsed: 0.1,
};

describe("runEvents", () => {
  it("stops at the terminal event", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(sse([[1, started], [2, delta], [3, finished]])));
    expect(await collect(runEvents("r1", { fetchImpl }))).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reconnects after the last seq and skips duplicates", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      // 第一次：收到 2 个事件后断开
      .mockResolvedValueOnce(streamResponse(sse([[1, started], [2, delta]])))
      // 第二次：服务端重放了 2，应被跳过
      .mockResolvedValueOnce(streamResponse(sse([[2, delta], [3, delta], [4, finished]])));

    const seqs = await collect(runEvents("r1", { fetchImpl, retryDelay: () => 0 }));

    expect(seqs).toEqual([1, 2, 3, 4]);
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/runs/r1/events?after=0",
      "/api/runs/r1/events?after=2",
    ]);
  });

  it("does not retry business errors", async () => {
    const notFound = new Response(
      JSON.stringify({ error: { code: "run_not_found", message: "运行不存在" } }),
      { status: 404 },
    );
    const fetchImpl = vi.fn(async () => notFound);
    await expect(collect(runEvents("missing", { fetchImpl }))).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("gives up after repeated network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      collect(runEvents("r1", { fetchImpl, maxRetries: 2, retryDelay: () => 0 })),
    ).rejects.toThrow("Failed to fetch");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
