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

type Mode = "password" | "magic";

function LoginFormInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason");
  const nextPath = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handlePassword(e: React.FormEvent) {
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
      // Session cookie is set; bounce to the requested next path.
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

  function switchMode(next: Mode) {
    setMode(next);
    setErrorMsg(null);
    setMagicSent(false);
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
          <div>
            That email isn&apos;t on the Zapsight allowlist. Reach out to Sarah if you need access.
          </div>
        </div>
      )}
      {reason === "bad_link" && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 text-sm text-accent-red">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>Invalid magic link. Request a new one or sign in with your password.</div>
        </div>
      )}
      {reason === "exchange_failed" && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 text-sm text-accent-red">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>Magic link expired or already used. Request a new one or sign in with your password.</div>
        </div>
      )}

      {/* Mode tabs */}
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-edge-default bg-bg-elevated p-1">
        <button
          type="button"
          onClick={() => switchMode("password")}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider transition ${
            mode === "password"
              ? "bg-bg-surface text-accent-cyan shadow"
              : "text-ink-tertiary hover:text-ink-secondary"
          }`}
        >
          <KeyRound size={12} /> Password
        </button>
        <button
          type="button"
          onClick={() => switchMode("magic")}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider transition ${
            mode === "magic"
              ? "bg-bg-surface text-accent-cyan shadow"
              : "text-ink-tertiary hover:text-ink-secondary"
          }`}
        >
          <Mail size={12} /> Magic link
        </button>
      </div>

      {mode === "magic" && magicSent ? (
        <div className="rounded-xl border border-accent-emerald/40 bg-accent-emeraldMuted/30 p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 font-bold text-accent-emerald">
            <CheckCircle2 size={18} /> Check your inbox
          </div>
          <p className="text-ink-secondary">
            If <span className="font-mono text-ink-primary">{email}</span> is on the
            Zapsight allowlist, we just sent a magic link. Click it to sign in.
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
      ) : mode === "password" ? (
        <form onSubmit={handlePassword} className="space-y-4">
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
              Password
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

          <div className="text-center font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
            First time? Use the magic-link tab to sign in, then set a password from the nav.
          </div>
        </form>
      ) : (
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

          <div className="text-center font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
            Zapsight team allowlist · session lives in this browser
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
