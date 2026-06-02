/**
 * Auth middleware.
 *
 * Runs on every request. Refreshes the Supabase session cookie if needed
 * and gates protected paths behind a valid session.
 *
 * Public paths (no auth required):
 *   - /login                 — login page
 *   - /auth/callback         — magic-link redirect target
 *   - /api/auth/*            — magic-link request, logout
 *   - /_next/*, /favicon.ico — Next.js plumbing
 *
 * Everything else (including /, /api/research, /api/export, /api/reports)
 * requires an authenticated session. /api/* responses return 401 JSON;
 * page requests redirect to /login.
 *
 * Allowlist enforcement: we don't *send* magic links to non-whitelisted
 * emails (see /api/auth/magic-link), and on every request we re-check
 * that the session's email is still in WHITELIST_EMAILS. Removing an
 * email from the env var revokes their access on the next request.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieMutation = { name: string; value: string; options?: CookieOptions };

const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/_next/", "/favicon"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isWhitelisted(email: string | undefined | null): boolean {
  if (!email) return false;
  const raw = process.env.WHITELIST_EMAILS || "";
  const allowed = new Set(
    raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  if (allowed.size === 0) return false;
  return allowed.has(email.trim().toLowerCase());
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip plumbing.
  if (isPublicPath(pathname)) return NextResponse.next();

  // If Supabase isn't configured yet, let everything through so the app
  // still boots and the user can see the setup banner. We fail-open on
  // missing config (not on missing session) to keep the dev/setup loop
  // tolerable. Production prod has the env vars set, so this branch is
  // never hit there.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  const res = NextResponse.next();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet: CookieMutation[]) => {
        for (const { name, value, options } of toSet) {
          res.cookies.set({ name, value, ...options });
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isWhitelisted(user.email)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: user ? "Email not whitelisted." : "No session.",
          },
        },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
    if (user && !isWhitelisted(user.email)) {
      loginUrl.searchParams.set("reason", "not_allowed");
    }
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // Match everything except static assets — middleware itself decides
  // what's public vs protected via isPublicPath().
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
