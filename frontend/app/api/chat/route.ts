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
}

function detectProtocol(apiKey: string): "anthropic" | "openai" {
  return apiKey.trimStart().startsWith("sk-ant-") ? "anthropic" : "openai";
}

// ── OpenAI 兼容协议（OpenAI / DeepSeek / 自定义代理 等）──
async function streamOpenAI(body: ChatRequestBody): Promise<Response> {
  const client = new OpenAI({
    apiKey: body.apiKey,
    baseURL: body.baseUrl || undefined,
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

    // 根据 Key 前缀自动选择协议，无需前端传 provider
    const protocol = detectProtocol(body.apiKey);
    return protocol === "anthropic" ? streamAnthropic(body) : streamOpenAI(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
