/**
 * OpenRouter client.
 *
 * OpenRouter exposes an OpenAI-compatible API at https://openrouter.ai/api/v1.
 * We use the openai SDK as the transport and route to Claude (or any other
 * supported model) via the `model` field.
 *
 * Env vars:
 *   OPENROUTER_API_KEY   — required.
 *   OPENROUTER_MODEL     — default "anthropic/claude-sonnet-4.5".
 *   OPENROUTER_BASE_URL  — default "https://openrouter.ai/api/v1".
 */

import OpenAI from "openai";

const BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (_client) return _client;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local or to the Vercel project's environment variables.",
    );
  }

  _client = new OpenAI({
    apiKey,
    baseURL: BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://zapintel.vercel.app",
      "X-Title": "ZapIntel — Zapsight Client Intelligence",
    },
  });

  return _client;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function* streamChat(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): AsyncGenerator<string, void, unknown> {
  const client = getClient();
  const model = opts.model || DEFAULT_MODEL;

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
    max_tokens: opts.maxTokens ?? 3500,
    temperature: opts.temperature ?? 0.4,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

export async function completeChat(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const client = getClient();
  const model = opts.model || DEFAULT_MODEL;

  const response = await client.chat.completions.create({
    model,
    messages,
    stream: false,
    max_tokens: opts.maxTokens ?? 3500,
    temperature: opts.temperature ?? 0.4,
  });

  return response.choices?.[0]?.message?.content?.trim() || "";
}
