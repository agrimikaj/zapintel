"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Zap,
} from "lucide-react";

type FallbackMode = null | "supabase_password" | "magic_link";

function LoginFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason");
  const nextPath = params.get("next") || "/";

  // Default mode: simple shared-password (APP_PASSWORD on the server).
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fallback modes (shown only if simple-auth is not configured or the
  // user explicitly chooses the Supabase paths).
  const [fallback, setFallback] = useState<FallbackMode>(null);
  const [email, setEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  async function handleSimpleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (res.status === 503) {
        // Simple-auth not configured on this deployment — show the
        // Supabase magic-link fallback automatically.
        setFallback("magic_link");
        setErrorMsg("This deployment uses email-based login. Enter your email below.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function handleSupabasePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), next: nextPath }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      setMagicSent(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-edge-default bg-bg-surface p-8 shadow-2xl shadow-black/40">
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-cyan text-bg-primary">
          <Zap size={18} />
        </div>
        <div className="leading-none">
          <div className="text-xl font-bold">
            Zap<span className="text-accent-cyan">Intel</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
            client intelligence · by zapsight
          </div>
        </div>
      </div>

      {reason === "not_allowed" && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-amber/40 bg-accent-amberMuted/30 p-3 text-sm text-accent-amber">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>That email isn&apos;t on the Zapsight allowlist.</div>
        </div>
      )}
      {reason === "bad_link" && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 text-sm text-accent-red">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>Invalid magic link. Sign in with your password instead.</div>
        </div>
      )}
      {reason === "exchange_failed" && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 text-sm text-accent-red">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>Magic link expired or already used.</div>
        </div>
      )}
      {reason === "no_auth_configured" && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 text-sm text-accent-red">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            No authentication is configured on this deployment. Contact the
            administrator.
          </div>
        </div>
      )}

      {fallback === "magic_link" && magicSent ? (
        <div className="rounded-xl border border-accent-emerald/40 bg-accent-emeraldMuted/30 p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 font-bold text-accent-emerald">
            <CheckCircle2 size={18} /> Check your inbox
          </div>
          <p className="text-ink-secondary">
            If <span className="font-mono text-ink-primary">{email}</span> is on
            the Zapsight allowlist, we just sent a magic link.
          </p>
          <button
            onClick={() => {
              setMagicSent(false);
              setEmail("");
            }}
            className="mt-4 font-mono text-xs uppercase tracking-wider text-accent-cyan hover:text-accent-emerald"
          >
            Send to a different email →
          </button>
        </div>
      ) : fallback === "magic_link" ? (
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div>
            <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
              Email
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
              <Mail size={16} className="text-ink-tertiary" />
              <input
                required
                autoFocus
                type="email"
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@zapsight.co.uk"
                className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
              />
            </div>
          </div>
          {errorMsg && (
            <div className="rounded-lg border border-accent-red/40 bg-accent-redMuted/30 p-3 font-mono text-xs text-accent-red">
              {errorMsg}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-cyan py-3 font-bold text-bg-primary transition hover:bg-accent-emerald disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
            {submitting ? "Sending..." : "Email me a magic link"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFallback(null);
              setErrorMsg(null);
            }}
            className="w-full text-center font-mono text-[11px] uppercase tracking-wider text-ink-tertiary hover:text-accent-cyan"
          >
            ← Use shared password instead
          </button>
        </form>
      ) : fallback === "supabase_password" ? (
        <form onSubmit={handleSupabasePassword} className="space-y-4">
          <div>
            <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
              Email
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
              <Mail size={16} className="text-ink-tertiary" />
              <input
                required
                autoFocus
                type="email"
                autoComplete="username"
                disabled={submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@zapsight.co.uk"
                className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
              Your account password
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
              <KeyRound size={16} className="text-ink-tertiary" />
              <input
                required
                type="password"
                autoComplete="current-password"
                disabled={submitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
              />
            </div>
          </div>
          {errorMsg && (
            <div className="rounded-lg border border-accent-red/40 bg-accent-redMuted/30 p-3 font-mono text-xs text-accent-red">
              {errorMsg}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-cyan py-3 font-bold text-bg-primary transition hover:bg-accent-emerald disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
            {submitting ? "Signing in..." : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setFallback(null);
              setErrorMsg(null);
            }}
            className="w-full text-center font-mono text-[11px] uppercase tracking-wider text-ink-tertiary hover:text-accent-cyan"
          >
            ← Use shared password instead
          </button>
        </form>
      ) : (
        <form onSubmit={handleSimpleLogin} className="space-y-4">
          <div>
            <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
              Team password
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
              <KeyRound size={16} className="text-ink-tertiary" />
              <input
                required
                autoFocus
                type="password"
                autoComplete="current-password"
                disabled={submitting}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-accent-red/40 bg-accent-redMuted/30 p-3 font-mono text-xs text-accent-red">
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-cyan py-3 font-bold text-bg-primary transition hover:bg-accent-emerald disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
            {submitting ? "Signing in..." : "Sign in"}
          </button>

          <div className="flex items-center justify-center gap-4 font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
            <button
              type="button"
              onClick={() => {
                setFallback("magic_link");
                setErrorMsg(null);
              }}
              className="hover:text-accent-cyan"
            >
              Magic link →
            </button>
            <span className="opacity-50">·</span>
            <button
              type="button"
              onClick={() => {
                setFallback("supabase_password");
                setErrorMsg(null);
              }}
              className="hover:text-accent-cyan"
            >
              Account password →
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={<div className="font-mono text-sm text-ink-tertiary">Loading...</div>}>
        <LoginFormInner />
      </Suspense>
    </div>
  );
}
