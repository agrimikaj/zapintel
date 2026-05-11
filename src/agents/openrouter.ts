/**
 * OpenRouter client (plain fetch).
 *
 * We previously used the `openai` SDK, but on Vercel's serverless Node
 * runtime the SDK wrapped real failures as a generic "Connection error",
 * making it impossible to diagnose. Switched to plain fetch against
 * OpenRouter's OpenAI-compatible /chat/completions endpoint. Errors now
 * surface with HTTP status + provider message.
 *
 * Env vars:
 *   OPENROUTER_API_KEY   — required.
 *   OPENROUTER_MODEL     — default "anthropic/claude-sonnet-4.5".
 *   OPENROUTER_BASE_URL  — default "https://openrouter.ai/api/v1".
 */

const BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local locally, or to the Vercel project's Environment Variables in production.",
    );
  }
  return key;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; code?: string | number };
}

export async function completeChat(
  messages: ChatMessage[],
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const model = opts.model || DEFAULT_MODEL;
  const body = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 3500,
    temperature: opts.temperature ?? 0.4,
    stream: false,
  };

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://zapintel.vercel.app",
      "X-Title": "ZapIntel — Zapsight Client Intelligence",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();

  if (!res.ok) {
    // Try to surface the OpenRouter error message; fall back to status.
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as ChatCompletionResponse;
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* not JSON */
    }
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 400)}`);
  }

  let parsed: ChatCompletionResponse;
  try {
    parsed = JSON.parse(raw) as ChatCompletionResponse;
  } catch {
    throw new Error(`OpenRouter returned non-JSON: ${raw.slice(0, 200)}`);
  }

  if (parsed.error?.message) {
    throw new Error(`OpenRouter error: ${parsed.error.message}`);
  }

  const content = parsed.choices?.[0]?.message?.content?.trim() || "";
  return content;
}
