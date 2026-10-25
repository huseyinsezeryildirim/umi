// What this browser can record. Screen capture works in every desktop browser, but the
// computer's own sound (videos, calls, apps) only comes through in Chromium browsers.

export type SoundSupport = "full" | "tab" | "none";
export type BrowserInfo = { name: string; chromium: boolean; sound: SoundSupport; mobile: boolean };

type Brands = { brands?: { brand: string; version: string }[]; mobile?: boolean };

export function browserInfo(): BrowserInfo {
  const ua = navigator.userAgent;
  const data = (navigator as Navigator & { userAgentData?: Brands }).userAgentData;
  const brave = !!(navigator as Navigator & { brave?: unknown }).brave;
  const mobile = data?.mobile ?? /Android|iPhone|iPad/.test(ua);
  const chromium = !!data?.brands?.some((b) => b.brand === "Chromium") || /Chrome\/|Chromium\/|Edg\//.test(ua);
  const name = brave
    ? "Brave"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Vivaldi/.test(ua)
          ? "Vivaldi"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : chromium
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "this browser";
  let sound: SoundSupport = "none";
  if (chromium) {
    const version = Number(data?.brands?.find((b) => b.brand === "Chromium")?.version ?? /Chrom(?:e|ium)\/(\d+)/.exec(ua)?.[1] ?? 0);
    // Windows and ChromeOS share the whole computer's sound; macOS does from Chromium 141 (macOS 14.2+).
    if (/Windows|CrOS/.test(ua)) sound = "full";
    else if (/Mac/.test(ua)) sound = version >= 141 ? "full" : "tab";
    else sound = "tab";
  }
  return { name, chromium, sound, mobile };
}
