"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { forgotPassword, getToken, me, resetPassword, signIn, signUp, verifyEmail } from "@/lib/account";
import { Mark } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

/** One quiet card on the sky, shared by every account page. */
export function Shell({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-[100svh] place-items-center overflow-hidden px-4 py-16">
      <img src="/photos/sky.jpg" alt="" className="absolute inset-0 size-full object-cover" />
      <a href="/" className="absolute top-5 left-5 flex items-center gap-2 text-[17px] font-semibold text-white drop-shadow-[0_1px_6px_rgb(0_40_90/0.35)]">
        <Mark className="size-6" mono /> Umi
      </a>
      <motion.div
        className="relative w-full max-w-[400px] rounded-[28px] bg-white/90 p-8 shadow-[0_0_0_1px_rgb(255_255_255/0.6),0_40px_100px_-30px_rgb(20_60_130/0.55)] backdrop-blur-xl sm:p-10"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <Mark className="size-9 text-accent" />
        <h1 className="mt-5 text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{lead}</p>
        {children}
      </motion.div>
    </main>
  );
}

function Field({ label, hint, ...input }: { label: React.ReactNode; hint?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between text-[13px] font-medium">
        {label}
        {hint}
      </span>
      <input
        required
        {...input}
        className="h-11 rounded-xl bg-white px-3.5 text-[15px] shadow-[0_0_0_1px_rgb(17_24_39/0.12)] outline-none transition-shadow focus:shadow-[0_0_0_2px_var(--color-accent)]"
      />
    </label>
  );
}

function ErrorLine({ error }: { error: string }) {
  if (!error) return null;
  return (
    <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-[#fef3f2] px-3.5 py-2.5 text-[14px] text-[#b42318]">
      {error}
    </motion.p>
  );
}

function Submit({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="mt-2 h-11 rounded-xl bg-ink text-[15px] font-medium text-white transition-opacity disabled:opacity-60">
      {children}
    </button>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-center text-[14px] text-muted">{children}</p>;
}

/** Runs a form action with a busy state and an error line. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = (action: () => Promise<void>) => async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };
  return { busy, error, run };
}

/** Where to go after signing in: `?next=` when it's a page on this site, else the app. */
const nextPath = () => {
  const next = new URLSearchParams(location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
};

const tokenFromUrl = () => new URLSearchParams(location.search).get("token") ?? "";

/** Sign in and sign up. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const signup = mode === "signup";

  // On the way to buying Pro (/upgrade): say so.
  const [forPro, setForPro] = useState(false);
  useEffect(() => setForPro(nextPath().startsWith("/upgrade")), []);

  // Already signed in (and the session still works): straight on.
  useEffect(() => {
    if (getToken()) void me().then((a) => a && location.replace(nextPath()), () => {});
  }, []);

  const submit = run(async () => {
    await (signup ? signUp : signIn)(email, password);
    location.assign(nextPath());
  });

  return (
    <Shell
      title={signup ? "Create your account" : "Welcome back"}
      lead={
        forPro
          ? `${signup ? "Create" : "Sign in to"} your Umi account first. Paying for Pro comes right after.`
          : signup
            ? "Record in your browser and share with a link."
            : "Sign in to record and edit."
      }
    >
      <form onSubmit={submit} className="mt-8 grid gap-3">
        <Field
          label="Email"
          type={signup ? "email" : "text"}
          inputMode="email"
          autoCapitalize="none"
          autoComplete={signup ? "email" : "username"}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <Field
          label="Password"
          hint={
            signup ? (
              <span className="font-normal text-faint">8 characters or more</span>
            ) : (
              <a href="/forgot" className="font-normal text-accent">
                Forgot password?
              </a>
            )
          }
          type="password"
          minLength={signup ? 8 : undefined}
          autoComplete={signup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <ErrorLine error={error} />
        <Submit busy={busy}>{busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}</Submit>
      </form>
      <Footer>
        {signup ? "Already have an account? " : "New to Umi? "}
        <a href={(signup ? "/login" : "/signup") + (typeof location === "undefined" ? "" : location.search)} className="font-medium text-accent">
          {signup ? "Sign in" : "Create an account"}
        </a>
      </Footer>
    </Shell>
  );
}

/** Asks for a reset link. */
export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  const submit = run(async () => {
    await forgotPassword(email);
    setSent(true);
  });
  if (sent)
    return (
      <Shell title="Check your email" lead={`If ${email} has an Umi account, a link to choose a new password is on its way. It works for 1 hour.`}>
        <Footer>
          <a href="/login" className="font-medium text-accent">
            Back to sign in
          </a>
        </Footer>
      </Shell>
    );
  return (
    <Shell title="Forgot your password?" lead="We’ll email you a link to choose a new one.">
      <form onSubmit={submit} className="mt-8 grid gap-3">
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <ErrorLine error={error} />
        <Submit busy={busy}>{busy ? "Sending…" : "Send link"}</Submit>
      </form>
      <Footer>
        Remembered it?{" "}
        <a href="/login" className="font-medium text-accent">
          Sign in
        </a>
      </Footer>
    </Shell>
  );
}

/** Chooses a new password from an emailed link. */
export function ResetForm() {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const submit = run(async () => {
    await resetPassword(tokenFromUrl(), password);
    location.assign("/app");
  });
  return (
    <Shell title="Choose a new password" lead="You’ll be signed out everywhere else.">
      <form onSubmit={submit} className="mt-8 grid gap-3">
        <Field label="New password" hint={<span className="font-normal text-faint">8 characters or more</span>} type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <ErrorLine error={error} />
        <Submit busy={busy}>{busy ? "Saving…" : "Save and sign in"}</Submit>
      </form>
      {error && (
        <Footer>
          <a href="/forgot" className="font-medium text-accent">
            Send a new link
          </a>
        </Footer>
      )}
    </Shell>
  );
}

/** Opens from the confirmation email. One request per page load, even when effects run twice. */
let verifying: Promise<void> | null = null;
export function VerifyPage() {
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState("");
  useEffect(() => {
    verifying ??= verifyEmail(tokenFromUrl());
    verifying
      .then(() => setState("done"))
      .catch((e) => (setError((e as Error).message), setState("failed")));
  }, []);
  if (state === "working")
    return (
      <Shell title="Confirming…" lead="One moment.">
        {null}
      </Shell>
    );
  if (state === "failed")
    return (
      <Shell title="That link didn’t work" lead={error}>
        <Footer>
          <a href="/app" className="font-medium text-accent">
            Open Umi to send a new one
          </a>
        </Footer>
      </Shell>
    );
  return (
    <Shell title="Email confirmed" lead="Thanks. Your account is all set.">
      <a href="/app" className="mt-8 grid h-11 place-items-center rounded-xl bg-ink text-[15px] font-medium text-white">
        Start recording
      </a>
    </Shell>
  );
}
