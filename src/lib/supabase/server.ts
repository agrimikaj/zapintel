/**
 * Server-side Supabase clients.
 *
 * Two flavors:
 *   - getServerSupabase(): cookie-bound client used in Route Handlers,
 *     Server Components, and Middleware. Carries the user's session.
 *   - getServiceSupabase(): privileged client using the service-role key.
 *     Bypasses RLS — use ONLY in trusted server code, never expose to the
 *     browser. We use it for the whitelist check (which has to read the
 *     allowed_emails table before a user has a session).
 */

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type CookieMutation = { name: string; value: string; options?: CookieOptions };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: CookieMutation[]) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't mutate cookies — middleware/route handlers handle it.
          }
        },
      },
    },
  );
}

export function getServiceSupabase() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Parse comma-separated WHITELIST_EMAILS env into a lowercase Set. */
export function getWhitelist(): Set<string> {
  const raw = process.env.WHITELIST_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string): boolean {
  const wl = getWhitelist();
  if (wl.size === 0) return false; // fail closed if not configured
  return wl.has(email.trim().toLowerCase());
}
