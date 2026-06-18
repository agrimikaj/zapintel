/**
 * Zapsight Brain client for zapintel — shared cross-agent memory.
 *
 * Returns null when BRAIN_API_KEY / BRAIN_BASE_URL aren't configured, so the
 * whole integration is opt-in and fully degradable: no env → no brain calls,
 * pipeline behaves exactly as before. All callers treat the brain as
 * best-effort (recall/record wrapped in try/catch; a 2s timeout).
 */
import { BrainClient } from "./sdk";

let cached: BrainClient | null = null;

export function getBrain(): BrainClient | null {
  if (cached) return cached;
  const apiKey = process.env.BRAIN_API_KEY;
  const baseUrl = process.env.BRAIN_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  cached = new BrainClient({ apiKey, baseUrl, timeoutMs: 2500 });
  return cached;
}
