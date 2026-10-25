"use client";

import { useEffect, useState } from "react";

const RELEASES = "https://github.com/umi-cam/umi/releases/latest/download";

export const PLATFORMS = [
  { key: "mac-arm", name: "macOS", detail: "Apple silicon", label: "Download for Mac", href: `${RELEASES}/Umi_aarch64.dmg` },
  { key: "mac-intel", name: "macOS", detail: "Intel", label: "Download for Mac (Intel)", href: `${RELEASES}/Umi_x64.dmg` },
  { key: "windows", name: "Windows", detail: "10 and 11", label: "Download for Windows", href: `${RELEASES}/Umi_x64-setup.exe` },
  { key: "linux", name: "Linux", detail: "AppImage · .deb", label: "Download for Linux", href: `${RELEASES}/Umi_amd64.AppImage` },
  { key: "chrome", name: "Browser", detail: "No install", label: "Record in your browser", href: "/signup" },
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
      // Phones and tablets can't run it: no guess, the button lists every platform.
      if (/Android|iPhone|iPad|Mobile/.test(ua)) return setKey(null);
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

/** The main button: the right download for this computer, as a glass pill. */
export function DownloadButton() {
  const key = usePlatform();
  const p = PLATFORMS.find((x) => x.key === key);
  const icon = key?.startsWith("mac") ? ICON.mac : key === "windows" ? ICON.windows : null;
  return (
    <a href={p ? p.href : "https://github.com/umi-cam/umi/releases/latest"} className="btn-glass">
      {icon}
      {p ? p.label : "Download Umi"}
    </a>
  );
}
