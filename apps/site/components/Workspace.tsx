"use client";

import { useEffect, useState } from "react";
import { type Account, me, signOut } from "@/lib/account";
import { Recorder } from "./Recorder";
import { Mark } from "./ui";

/** After signing in: the web recorder and editor, with the account in the corner. */
export function Workspace() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");

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

  return <Recorder account={<AccountMenu account={account} />} />;
}

function AccountMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const letter = (account.email ?? "?")[0].toUpperCase();
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Account" className="grid size-9 place-items-center rounded-full bg-accent text-[14px] font-semibold text-white">
        {letter}
      </button>
      {open && (
        <div className="absolute top-11 right-0 z-50 w-60 rounded-2xl bg-white p-2 text-left shadow-[0_0_0_1px_rgb(17_24_39/0.08),0_20px_50px_-12px_rgb(17_24_39/0.25)]">
          <p className="truncate px-3 pt-2 text-[14px] font-medium">{account.email}</p>
          <p className="px-3 pb-2 text-[12px] text-faint">{account.isPaid ? "Umi Cloud" : "Free"}</p>
          <a href="/" className="block rounded-xl px-3 py-2 text-[14px] hover:bg-ink/5">
            Umi website
          </a>
          <button type="button" onClick={() => void signOut().then(() => location.assign("/"))} className="w-full rounded-xl px-3 py-2 text-left text-[14px] text-[#b42318] hover:bg-[#fef3f2]">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
