/**
 * Auth middleware — fail-closed gate.
 *
 * Modes (checked in order):
 *
 *   1. SIMPLE AUTH — enabled when `APP_PASSWORD` is set on the server.
 *      Verifies an HMAC-signed `zapintel_session` cookie on every
 *      request. This is the path currently used on zapintel.vercel.app.
 *
 *   2. SUPABASE AUTH — enabled when the Supabase env vars are set AND
 *      `APP_PASSWORD` is unset. Requires a valid Supabase session whose
 *      email is on WHITELIST_EMAILS.
 *
 *   3. FAIL CLOSED — if neither mode is configured, the app refuses to
 *      serve protected paths. We do NOT silently let everyone in (the
 *      previous behavior). API requests get 503; page requests redirect
 *      to /login with a reason.
 *
 * Public paths (no auth required):
 *   - /login                  — login page
 *   - /auth/callback          — Supabase magic-link redirect target
 *   - /api/auth/login         — simple-auth password submit
 *   - /api/auth/logout        — clears whatever session exists
 *   - /api/auth/magic-link    — Supabase magic-link request
 *   - /_next/*, /favicon.ico  — Next.js plumbing
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/simpleAuth";

const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/_next/", "/favicon"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function loginRedirect(req: NextRequest, reason?: string): NextResponse {
  const loginUrl = new URL("/login", req.url);
  if (req.nextUrl.pathname !== "/") {
    loginUrl.searchParams.set("next", req.nextUrl.pathname);
  }
  if (reason) loginUrl.searchParams.set("reason", reason);
  return NextResponse.redirect(loginUrl);
}

function unauthorizedJson(message: string): NextResponse {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message } },
    { status: 401 },
  );
}

function noAuthConfiguredResponse(req: NextRequest): NextResponse {
  if (isApiPath(req.nextUrl.pathname)) {
    return NextResponse.json(
      {
        error: {
          code: "NO_AUTH_CONFIGURED",
          message:
            "No authentication mechanism is configured on this deployment.",
        },
      },
      { status: 503 },
    );
  }
  return loginRedirect(req, "no_auth_configured");
}

async function checkSupabase(req: NextRequest): Promise<NextResponse | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  // Lazy import so deployments without Supabase don't pay the cost.
  const { createServerClient } = await import("@supabase/ssr");
  type CookieMutation = {
    name: string;
    value: string;
    options?: Record<string, unknown>;
  };

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
  if (!user) {
    return isApiPath(req.nextUrl.pathname)
      ? unauthorizedJson("No session.")
      : loginRedirect(req);
  }

  const wlRaw = process.env.WHITELIST_EMAILS || "";
  const wl = new Set(
    wlRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  );
  if (wl.size > 0 && (!user.email || !wl.has(user.email.toLowerCase()))) {
    return isApiPath(req.nextUrl.pathname)
      ? unauthorizedJson("Email not whitelisted.")
      : loginRedirect(req, "not_allowed");
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const simpleEnabled = Boolean(process.env.APP_PASSWORD);

  if (simpleEnabled) {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token && (await verifySessionToken(token))) {
      return NextResponse.next();
    }
    return isApiPath(pathname)
      ? unauthorizedJson("Invalid or expired session.")
      : loginRedirect(req);
  }

  const supabaseResult = await checkSupabase(req);
  if (supabaseResult !== null) return supabaseResult;

  // Neither auth mode configured — fail closed.
  return noAuthConfiguredResponse(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
