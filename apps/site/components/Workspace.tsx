"use client";

import { useEffect, useState } from "react";
import { API, type Account, type Plan, deleteAccount, me, resendVerification, setPlanForTesting, signOut } from "@/lib/account";
import { openPortal } from "@/lib/billing";
import { saveTake } from "@/lib/library";
import { Recorder } from "./Recorder";
import { Mark } from "./ui";

/**
 * After signing in: the library and editor (the Mac app's own, built for the web, at /editor)
 * and the web recorder for new recordings, with the account in the corner.
 */
export function Workspace() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<{ kind: "library"; open?: string } | { kind: "record" } | { kind: "saving" }>(() =>
    typeof location !== "undefined" && new URLSearchParams(location.search).has("record") ? { kind: "record" } : { kind: "library" },
  );

  // The editor asks for a new recording ("New recording" in its library).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.umi === "record") setView({ kind: "record" });
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    me()
      .then((a) => (a ? setAccount(a) : location.replace("/login")))
      .catch((e) => ((e as { status?: number }).status === 401 ? location.replace("/login") : setError((e as Error).message)));
  }, []);

  if (error)
    return (
      <main className="grid min-h-[100svh] place-items-center px-4 text-center">
        <div>
          <p className="text-muted">{error}</p>
          <button type="button" onClick={() => location.reload()} className="btn-dark mt-4">
            Try again
          </button>
        </div>
      </main>
    );
  if (!account)
    return (
      <main className="grid min-h-[100svh] place-items-center">
        <Mark className="size-8 animate-pulse text-accent" />
      </main>
    );

  const menu = (side: "left" | "right") => <AccountMenu account={account} onChange={setAccount} side={side} />;
  return (
    <>
      {!account.emailVerified && <VerifyBanner email={account.email} />}
      {view.kind === "record" && (
        <Recorder
          account={menu("right")}
          onCancel={() => setView({ kind: "library" })}
          onTake={(take) => {
            setView({ kind: "saving" });
            void saveTake(account.id, take).then(
              (id) => setView({ kind: "library", open: id }),
              () => setView({ kind: "library" }),
            );
          }}
        />
      )}
      {view.kind === "saving" && (
        <main className="grid min-h-[100svh] place-items-center text-[15px] text-muted">
          <div className="flex flex-col items-center gap-3">
            <Mark className="size-8 animate-pulse text-accent" />
            Saving your recording…
          </div>
        </main>
      )}
      {view.kind === "library" && (
        <>
          <iframe
            title="Umi"
            src={`/editor/index.html?account=${encodeURIComponent(account.id)}&api=${encodeURIComponent(API)}${view.open ? `&open=${encodeURIComponent(view.open)}` : ""}`}
            className="fixed inset-0 h-full w-full border-0"
            allow="clipboard-write; fullscreen"
          />
          {/* Where the Mac app has its window buttons. */}
          <div className="fixed top-[13px] left-4 z-10">{menu("left")}</div>
        </>
      )}
    </>
  );
}

/** Until the email is confirmed: a thin reminder with a way to resend the link. */
function VerifyBanner({ email }: { email: string | null }) {
  const [sent, setSent] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-[14px] text-white shadow-[0_20px_50px_-12px_rgb(17_24_39/0.5)]">
      <span className="flex-1">{sent ? `Sent. Check ${email}.` : `Confirm your email: we sent a link to ${email}.`}</span>
      {!sent && (
        <button type="button" onClick={() => void resendVerification().then(() => setSent(true))} className="font-medium whitespace-nowrap text-[#8ab8ff]">
          Send again
        </button>
      )}
      <button type="button" aria-label="Hide" onClick={() => setHidden(true)} className="text-white/50 hover:text-white">
        ✕
      </button>
    </div>
  );
}

const PLAN_NAMES: Record<Plan, string> = { free: "Free", pro: "Pro", team: "Team" };

function AccountMenu({ account, onChange, side = "right" }: { account: Account; onChange: (a: Account) => void; side?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const letter = (account.email ?? "?")[0].toUpperCase();
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Account" className="grid size-9 place-items-center rounded-full bg-accent text-[14px] font-semibold text-white">
        {letter}
      </button>
      {open && (
        <div className={`absolute top-11 ${side === "left" ? "left-0" : "right-0"} z-50 w-60 rounded-2xl bg-white p-2 text-left shadow-[0_0_0_1px_rgb(17_24_39/0.08),0_20px_50px_-12px_rgb(17_24_39/0.25)]`}>
          <p className="truncate px-3 pt-2 text-[14px] font-medium">{account.email}</p>
          <p className="px-3 pb-2 text-[12px] text-faint">
            {PLAN_NAMES[account.plan]} plan
            {account.emailVerified ? "" : " · email not confirmed"}
          </p>
          {process.env.NODE_ENV !== "production" && (
            <div className="mx-1 mb-2 rounded-xl bg-[#fff8eb] p-2">
              <p className="px-1 pb-1.5 text-[11px] font-medium text-[#8a5a0f]">Testing: switch plan</p>
              <div className="grid grid-cols-3 gap-1">
                {(Object.keys(PLAN_NAMES) as Plan[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void setPlanForTesting(p).then(onChange)}
                    className={`h-7 rounded-lg text-[12px] font-medium ${account.plan === p ? "bg-[#7a4b00] text-white" : "bg-white text-[#7a4b00]"}`}
                  >
                    {PLAN_NAMES[p]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {account.plan === "free" ? (
            <a href="/upgrade" className="block rounded-xl px-3 py-2 text-[14px] font-medium text-accent hover:bg-ink/5">
              Upgrade to Pro
            </a>
          ) : (
            <button type="button" onClick={() => void openPortal().catch((e) => alert(e.message))} className="w-full rounded-xl px-3 py-2 text-left text-[14px] hover:bg-ink/5">
              Manage subscription
            </button>
          )}
          <a href="/" className="block rounded-xl px-3 py-2 text-[14px] hover:bg-ink/5">
            Umi website
          </a>
          <button type="button" onClick={() => void signOut().then(() => location.assign("/"))} className="w-full rounded-xl px-3 py-2 text-left text-[14px] hover:bg-ink/5">
            Sign out
          </button>
          <DeleteAccount />
        </div>
      )}
    </div>
  );
}

/** Deleting the account: asks for the password, then removes everything on Umi Cloud. */
function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl px-3 py-2 text-left text-[14px] text-[#b42318] hover:bg-[#fef3f2]">
        Delete account…
      </button>
    );
  return (
    <form
      className="m-1 rounded-xl bg-[#fef3f2] p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        deleteAccount(password)
          .then(() => location.assign("/"))
          .catch((err) => (setError((err as Error).message), setBusy(false)));
      }}
    >
      <p className="text-[12px] text-[#7a271a]">Your account, links, videos on Umi Cloud and their stats are deleted for good. Recordings on your computer stay.</p>
      <input type="password" required placeholder="Your password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" className="mt-2 h-9 w-full rounded-lg bg-white px-2.5 text-[13px] shadow-[0_0_0_1px_rgb(180_35_24/0.25)] outline-none" />
      {error && <p className="mt-1.5 text-[12px] text-[#b42318]">{error}</p>}
      <div className="mt-2 flex gap-1.5">
        <button type="submit" disabled={busy} className="h-8 flex-1 rounded-lg bg-[#d92d20] text-[12px] font-medium text-white disabled:opacity-60">
          {busy ? "Deleting…" : "Delete everything"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-8 flex-1 rounded-lg bg-white text-[12px] font-medium">
          Keep
        </button>
      </div>
    </form>
  );
}
