"use client";

import { useEffect, useState } from "react";
import { Mark, Reveal } from "./ui";

const RELEASES = "https://github.com/umi-cam/umi/releases/latest/download";

export const PLATFORMS = [
  { key: "mac-arm", name: "macOS", detail: "Apple silicon", label: "Download for Mac", href: `${RELEASES}/Umi_aarch64.dmg` },
  { key: "mac-intel", name: "macOS", detail: "Intel", label: "Download for Mac (Intel)", href: `${RELEASES}/Umi_x64.dmg` },
  { key: "windows", name: "Windows", detail: "10 and 11", label: "Download for Windows", href: `${RELEASES}/Umi_x64-setup.exe` },
  { key: "linux", name: "Linux", detail: "AppImage · .deb", label: "Download for Linux", href: `${RELEASES}/Umi_amd64.AppImage` },
  { key: "chrome", name: "Chrome", detail: "Extension", label: "Add to Chrome", href: "https://chromewebstore.google.com/" },
] as const;
type Key = (typeof PLATFORMS)[number]["key"];

/** Which download fits this computer (Apple silicon is the safe guess for Macs). */
function usePlatform(): Key | null {
  const [key, setKey] = useState<Key | null>(null);
  useEffect(() => {
    (async () => {
      const ua = navigator.userAgent;
      const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ platform?: string; architecture?: string }> } }).userAgentData;
      let platform = "";
      let arch = "";
      try {
        const v = await data?.getHighEntropyValues(["platform", "architecture"]);
        platform = v?.platform ?? "";
        arch = v?.architecture ?? "";
      } catch {}
      const os = /CrOS/.test(ua) || platform === "Chrome OS" ? "chrome" : platform === "macOS" || /Mac/.test(ua) ? "mac" : platform === "Windows" || /Win/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : null;
      setKey(os === "mac" ? (arch === "x86" ? "mac-intel" : "mac-arm") : os);
    })();
  }, []);
  return key;
}

const ICON: Record<string, React.ReactNode> = {
  mac: (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path fill="currentColor" d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.7-1.3Z" />
    </svg>
  ),
  windows: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="currentColor" d="M3 5.5 10.4 4.5v7H3zm0 13 7.4 1v-7H3zm8.3 1.1L21 21v-8.5h-9.7zm0-15.2v7.1H21V3z" />
    </svg>
  ),
};

export function DownloadButton({ size = "md" }: { size?: "md" | "lg" }) {
  const key = usePlatform();
  const p = PLATFORMS.find((x) => x.key === key);
  const icon = key?.startsWith("mac") ? ICON.mac : key === "windows" ? ICON.windows : null;
  return (
    <a href={p ? p.href : "#download"} className={`btn btn-ink ${size === "lg" ? "btn-lg" : ""}`}>
      {icon}
      {p ? p.label : "Download Umi"}
    </a>
  );
}

export function Download() {
  const key = usePlatform();
  return (
    <section id="download" className="px-4 py-28">
      <Reveal className="relative mx-auto max-w-5xl overflow-hidden rounded-[32px] bg-ink px-6 py-16 text-center text-white sm:px-12">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgb(17_111_245/0.45),transparent_70%)]" />
        <div className="relative">
          <Mark className="mx-auto size-16 animate-[spin_24s_linear_infinite] text-white" />
          <h2 className="mt-6 text-4xl font-bold tracking-[-0.03em] text-balance sm:text-5xl">Make your next video the good one</h2>
          <p className="mt-3 text-white/60">Free for Mac, Windows, Linux and Chrome. No account needed.</p>
          <div className="mt-8 flex justify-center">
            <DownloadInverse platform={key} />
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-5">
            {PLATFORMS.map((p) => (
              <a
                key={p.key}
                href={p.href}
                className={`rounded-2xl px-3 py-3 text-left transition-colors ${p.key === key ? "bg-white/15 ring-1 ring-white/30" : "bg-white/5 hover:bg-white/10"}`}
              >
                <b className="block text-sm">{p.name}</b>
                <span className="text-xs text-white/55">{p.detail}</span>
              </a>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** On the dark card the main button turns white. */
function DownloadInverse({ platform }: { platform: Key | null }) {
  const p = PLATFORMS.find((x) => x.key === platform);
  return (
    <a href={p ? p.href : PLATFORMS[0].href} className="btn btn-lg bg-white font-semibold text-ink shadow-[0_10px_30px_rgb(0_0_0/0.3)] hover:bg-ice-top">
      {platform?.startsWith("mac") ? ICON.mac : platform === "windows" ? ICON.windows : null}
      {p ? p.label : "Download Umi"}
    </a>
  );
}
