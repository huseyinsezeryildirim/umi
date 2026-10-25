"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { getToken, signIn, signUp } from "@/lib/account";
import { Mark } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

/** The sign-in and sign-up page: one quiet card on the sky. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const signup = mode === "signup";

  // Already signed in: straight to the app.
  useEffect(() => {
    if (getToken()) location.replace("/app");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await (signup ? signUp : signIn)(email, password);
      location.assign("/app");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="relative grid min-h-[100svh] place-items-center overflow-hidden px-4 py-16">
      <img src="/photos/sky.jpg" alt="" className="absolute inset-0 size-full object-cover" />
      <a href="/" className="absolute top-5 left-5 flex items-center gap-2 text-[17px] font-semibold text-white drop-shadow-[0_1px_6px_rgb(0_40_90/0.35)]">
        <Mark className="size-6" /> Umi
      </a>
      <motion.div
        className="relative w-full max-w-[400px] rounded-[28px] bg-white/90 p-8 shadow-[0_0_0_1px_rgb(255_255_255/0.6),0_40px_100px_-30px_rgb(20_60_130/0.55)] backdrop-blur-xl sm:p-10"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <Mark className="size-9 text-accent" />
        <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.02em]">{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{signup ? "Record in your browser and share with a link." : "Sign in to record and edit."}</p>

        <form onSubmit={submit} className="mt-8 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              className="h-11 rounded-xl bg-white px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(17_24_39/0.12)] outline-none transition-shadow focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="flex justify-between text-[13px] font-medium">
              Password
              {signup && <span className="font-normal text-faint">8 characters or more</span>}
            </span>
            <input
              type="password"
              required
              minLength={signup ? 8 : undefined}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              className="h-11 rounded-xl bg-white px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(17_24_39/0.12)] outline-none transition-shadow focus:shadow-[0_0_0_2px_var(--color-accent)]"
            />
          </label>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-[#fef3f2] px-3.5 py-2.5 text-[14px] text-[#b42318]">
              {error}
            </motion.p>
          )}
          <button type="submit" disabled={busy} className="mt-2 h-11 rounded-xl bg-ink text-[15px] font-medium text-white transition-opacity disabled:opacity-60">
            {busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[14px] text-muted">
          {signup ? "Already have an account? " : "New to Umi? "}
          <a href={signup ? "/login" : "/signup"} className="font-medium text-accent">
            {signup ? "Sign in" : "Create an account"}
          </a>
        </p>
      </motion.div>
    </main>
  );
}
