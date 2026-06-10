"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Step = "email" | "code";

/**
 * Two-step email OTP sign-in.
 *
 * We send a numeric code (NOT a clickable magic link) because email security
 * scanners and ESP click-tracking prefetch links on delivery, which consumes
 * the single-use token before the human clicks — the link "expires in 2s". A
 * typed code has nothing to prefetch. signInWithOtp sends the code as long as
 * the Supabase email template uses `{{ .Token }}` (not `{{ .ConfirmationURL }}`).
 *
 * `emailRedirectTo` is still threaded with `next` so that if a template ever
 * reverts to a link, the round-trip still lands on the gated page. On code
 * verify we navigate with a full reload so the server re-reads the freshly
 * written session cookie before rendering the gated route.
 */
export function LoginForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function sendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    const supabase = createClient();
    // [AUDIT-FIX C1] thread `next` onto the callback URL as a fallback in case
    // the email template still emits a link; the callback route forwards `next`.
    const callback = new URL("/auth/callback", window.location.origin);
    if (next && next !== "/") callback.searchParams.set("next", next);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: callback.toString() },
    });

    setPending(false);
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setStep("code");
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });

    if (error) {
      setPending(false);
      setErrorMessage("That code is invalid or expired. Request a new one.");
      return;
    }
    // Hard navigation so the server re-reads the new session cookie. `next` is
    // already validated to start with "/" by the login page.
    window.location.assign(next && next.startsWith("/") ? next : "/");
  }

  const inputBase =
    "h-11 rounded-lg border border-black/[.12] bg-white px-3 text-base text-black outline-none focus:border-black/40 disabled:opacity-60 dark:border-white/[.18] dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-white/40";
  const buttonBase =
    "mt-2 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]";

  if (step === "code") {
    return (
      <form onSubmit={verifyCode} className="mt-6 flex flex-col gap-3">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          We emailed a sign-in code to <span className="font-medium">{email}</span>. Enter it below.
        </p>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Code
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            // Supabase email OTP length is project-configurable (6–10 digits).
            // Do NOT hardcode 6 — this project emits 8. Accept the full range so
            // the field never truncates the code the server actually sent.
            maxLength={10}
            pattern="[0-9]*"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            disabled={pending}
            className={`${inputBase} tracking-[0.3em]`}
            placeholder="Enter your code"
          />
        </label>
        <button type="submit" disabled={pending || code.length < 6} className={buttonBase}>
          {pending ? "Verifying…" : "Verify & sign in"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setCode("");
            setErrorMessage(null);
          }}
          disabled={pending}
          className="text-sm leading-6 text-zinc-500 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400"
        >
          Use a different email
        </button>
        {errorMessage && (
          <p className="text-sm leading-6 text-red-600 dark:text-red-400">{errorMessage}</p>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          className={inputBase}
          placeholder="you@example.com"
        />
      </label>
      <button type="submit" disabled={pending || email.length === 0} className={buttonBase}>
        {pending ? "Sending…" : "Email me a code"}
      </button>
      {errorMessage && (
        <p className="text-sm leading-6 text-red-600 dark:text-red-400">{errorMessage}</p>
      )}
    </form>
  );
}
