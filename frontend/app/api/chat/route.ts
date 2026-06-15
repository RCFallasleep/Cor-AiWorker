/**
 * POST /api/chat
 * 流式 LLM 代理接口
 *
 * 协议自动识别：
 *   - apiKey 以 "sk-ant-" 开头 → Anthropic SDK
 *   - 其他                      → OpenAI 兼容协议（适用于 OpenAI / DeepSeek / 自定义代理等）
 *
 * Body:
 *   messages - { role: 'user'|'assistant', content: string }[]
 *   model    - 模型 ID，如 'gpt-4o' / 'deepseek-v4-flash' / 'claude-opus-4-5'
 *   apiKey   - API Key（由前端从本地 SQLite 读取后传入）
 *   baseUrl  - 可选，自定义 Base URL（代理 / 转发地址）
 */

import { NextRequest } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "edge";

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  model: string;
  apiKey: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  provider?: "openai" | "anthropic" | "bedrock" | "vertex";
}

function resolveProtocol(body: ChatRequestBody): "openai" | "anthropic" | "bedrock" | "vertex" {
  if (body.provider) return body.provider;
  return body.apiKey.trimStart().startsWith("sk-ant-") ? "anthropic" : "openai";
}

// ── OpenAI 兼容协议（OpenAI / DeepSeek / 自定义代理 / MaaS 等）──
async function streamOpenAI(body: ChatRequestBody): Promise<Response> {
  const client = new OpenAI({
    apiKey: body.apiKey,
    baseURL: body.baseUrl || undefined,
    defaultHeaders: body.extraHeaders,
  });

  const stream = await client.chat.completions.create({
    model: body.model,
    messages: body.messages,
    stream: true,
    stream_options: { include_usage: true },
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", content: delta })}\n\n`));
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "done", inputTokens, outputTokens })}\n\n`)
      );
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Anthropic ──
async function streamAnthropic(body: ChatRequestBody): Promise<Response> {
  const client = new Anthropic({
    apiKey: body.apiKey,
    ...(body.baseUrl ? { baseURL: body.baseUrl } : {}),
    defaultHeaders: body.extraHeaders,
  });

  const stream = await client.messages.stream({
    model: body.model,
    max_tokens: 8192,
    messages: body.messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "delta", content: event.delta.text })}\n\n`)
          );
        }
      }

      const finalMsg = await stream.finalMessage();
      const inputTokens = finalMsg.usage?.input_tokens ?? 0;
      const outputTokens = finalMsg.usage?.output_tokens ?? 0;

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "done", inputTokens, outputTokens })}\n\n`)
      );
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Bedrock 原生协议（Next.js Edge 环境，用 fetch 实现流式透传）──
async function streamBedrock(body: ChatRequestBody): Promise<Response> {
  if (!body.baseUrl) {
    return new Response(JSON.stringify({ error: "Bedrock 协议需要填写 Base URL" }), { status: 400 });
  }

  // 构造 Bedrock 原生请求体
  const bedrockMessages = body.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role, content: [{ type: "text", text: m.content }] }));
  const systemParts = body.messages.filter(m => m.role === "system").map(m => m.content);

  const payload: Record<string, unknown> = {
    model: body.model,
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 8192,
    messages: bedrockMessages,
  };
  if (systemParts.length) payload.system = systemParts.join("\n\n");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(body.extraHeaders ?? {}),
  };

  const upstream = await fetch(body.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({ error: `Bedrock 网关错误 ${upstream.status}: ${errText.slice(0, 200)}` }), { status: 502 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body?.getReader();
      if (!reader) { controller.close(); return; }
      const decoder = new TextDecoder();
      let buffer = "";
      let inputTokens = 0, outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "delta", content: event.delta.text })}\n\n`
              ));
            } else if (event.type === "message_start") {
              inputTokens = event.message?.usage?.input_tokens ?? 0;
            } else if (event.type === "message_delta") {
              outputTokens = event.usage?.output_tokens ?? outputTokens;
            }
          } catch { /* 忽略非 JSON 行 */ }
        }
      }
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: "done", inputTokens, outputTokens })}\n\n`
      ));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ── Vertex AI Anthropic 协议（MaaS 网关 /google/anthropic/v1:streamRawPredict）──
async function streamVertex(body: ChatRequestBody): Promise<Response> {
  if (!body.baseUrl) {
    return new Response(JSON.stringify({ error: "Vertex AI 协议需要填写 Base URL（含 v1:streamRawPredict）" }), { status: 400 });
  }

  // Vertex AI 格式：不含 anthropic_version，不含 model（模型已在 URL 路径中）
  const userMessages = body.messages.filter(m => m.role !== "system");
  const systemParts = body.messages.filter(m => m.role === "system").map(m => m.content);

  const payload: Record<string, unknown> = {
    max_tokens: 8192,
    messages: userMessages,
  };
  if (systemParts.length) payload.system = systemParts.join("\n\n");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(body.extraHeaders ?? {}),
  };

  const upstream = await fetch(body.baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({ error: `Vertex AI 网关错误 ${upstream.status}: ${errText.slice(0, 200)}` }), { status: 502 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body?.getReader();
      if (!reader) { controller.close(); return; }
      const decoder = new TextDecoder();
      let buffer = "";
      let inputTokens = 0, outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "delta", content: event.delta.text })}\n\n`
              ));
            } else if (event.type === "message_start") {
              inputTokens = event.message?.usage?.input_tokens ?? 0;
            } else if (event.type === "message_delta") {
              outputTokens = event.usage?.output_tokens ?? outputTokens;
            } else if (event.type === "error") {
              const errMsg = event.error?.message ?? JSON.stringify(event);
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "error", message: `Vertex AI 错误: ${errMsg}` })}\n\n`
              ));
            }
          } catch { /* 忽略非 JSON 行 */ }
        }
      }
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: "done", inputTokens, outputTokens })}\n\n`
      ));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequestBody = await req.json();

    if (!body.apiKey) {
      return new Response(JSON.stringify({ error: "缺少 API Key" }), { status: 400 });
    }
    if (!body.model) {
      return new Response(JSON.stringify({ error: "缺少模型名" }), { status: 400 });
    }
    if (!body.messages?.length) {
      return new Response(JSON.stringify({ error: "消息不能为空" }), { status: 400 });
    }

    const protocol = resolveProtocol(body);
    if (protocol === "bedrock") return streamBedrock(body);
    if (protocol === "vertex") return streamVertex(body);
    if (protocol === "anthropic") return streamAnthropic(body);
    return streamOpenAI(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
