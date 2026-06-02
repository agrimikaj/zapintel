/**
 * Browser-side Supabase client.
 *
 * Used inside Client Components ("use client"). Reads the public anon key
 * from NEXT_PUBLIC_* env vars (safe to ship to the browser — RLS in
 * Postgres is what actually enforces row-level access).
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabase() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel + .env.local.",
    );
  }
  _client = createBrowserClient(url, anon);
  return _client;
}
