import type {
  StoreEventInput,
  StorePatternInput,
  RecallInput,
  RecallResult,
  Pattern,
  BrainEvent,
} from "./types";

export class BrainClient {
  constructor(private opts: { apiKey: string; baseUrl: string; timeoutMs?: number }) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 5000);
    try {
      const res = await fetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }

  events = {
    record: (input: StoreEventInput) => this.req<{ id: string }>("POST", "/v1/events", input),
    list: (
      params: { kind?: string; agentId?: string; limit?: number; since?: string; until?: string; tags?: string } = {},
    ) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return this.req<{ events: BrainEvent[] }>("GET", `/v1/events${q ? `?${q}` : ""}`);
    },
    search: (input: { query: string; kind?: string; limit?: number }) =>
      this.req<{ events: BrainEvent[] }>("POST", "/v1/events/search", input),
  };

  patterns = {
    upsert: (input: StorePatternInput) =>
      this.req<{ action: "inserted" | "strengthened"; id: string }>("POST", "/v1/patterns", input),
    list: (params: { scope?: string; limit?: number } = {}) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return this.req<{ patterns: Pattern[] }>("GET", `/v1/patterns${q ? `?${q}` : ""}`);
    },
    recall: (input: { query: string; scope?: string; limit?: number }) =>
      this.req<{ patterns: Pattern[] }>("POST", "/v1/patterns/recall", input),
    patch: (id: string, body: { active?: boolean; confidence?: number; bumpAppliedCount?: boolean }) =>
      this.req<{ ok: true }>("PATCH", `/v1/patterns/${id}`, body),
  };

  identity = {
    set: (key: string, value: unknown, opts?: { source?: string; confidence?: number }) =>
      this.req<{ ok: true }>("PUT", `/v1/identity/${encodeURIComponent(key)}`, { value, ...opts }),
    get: (key: string) =>
      this.req<{ key: string; value: unknown }>("GET", `/v1/identity/${encodeURIComponent(key)}`),
    all: () => this.req<{ identity: Record<string, unknown> }>("GET", "/v1/identity"),
    delete: (key: string) => this.req<{ ok: true }>("DELETE", `/v1/identity/${encodeURIComponent(key)}`),
  };

  recall = (input: RecallInput) => this.req<RecallResult>("POST", "/v1/recall", input);

  health = () => this.req<{ ok: boolean }>("GET", "/v1/health");
}

export type { StoreEventInput, StorePatternInput, RecallInput, RecallResult, Pattern, BrainEvent };
