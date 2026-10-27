// Share links from the web editor, the same way the desktop app makes them: the recording and its
// edit go up as they are (nothing is rendered here) and the viewer's browser draws the look; the
// link is copied as soon as it exists. Uses the website's sign-in (the same account and plan limits).
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { Session } from "./engine";

const q = new URLSearchParams(location.search);
// The website passes its API address; it's kept for the rest of the visit.
if (q.get("api")) sessionStorage.setItem("umi.api", q.get("api")!);
export const apiBase = () => sessionStorage.getItem("umi.api") ?? "http://localhost:8799";
export const sessionToken = () => localStorage.getItem("umi.session");

export type Video = Record<string, unknown> & { id: string; url: string };
type Progress<T> = { onmessage: (value: T) => void };
type ShareProgress = { stage: string; value: number; video?: Video };

class CloudError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = sessionToken();
  if (!token) throw new CloudError("Sign in to share links.");
  const r = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new CloudError((data as { error?: { message?: string } } | null)?.error?.message ?? `Umi Cloud answered ${r.status}.`);
  return data as T;
}

// Which link belongs to which recording (kept in this browser, like the desktop app's share.json).
const key = (id: string) => `umi.share.${id}`;
const remember = (id: string, video: Video | null) => {
  try {
    if (video) localStorage.setItem(key(id), JSON.stringify(video));
    else localStorage.removeItem(key(id));
  } catch {
    // Storage blocked: the link still works, the editor just won't remember it.
  }
};
const saved = (id: string): Video | null => {
  try {
    return JSON.parse(localStorage.getItem(key(id)) ?? "null");
  } catch {
    return null;
  }
};

export const cloudStatus = () => ({ connected: !!sessionToken(), server: apiBase() });

/** The recording's link, refreshed from Umi Cloud (null when it was never shared or is gone). */
export async function shareState(id: string): Promise<Video | null> {
  const video = saved(id);
  if (!video) return null;
  try {
    const fresh = (await call<{ video: Video }>("GET", `/api/videos/${video.id}`)).video;
    if (fresh.status === "deleted") throw new CloudError("gone");
    remember(id, fresh);
    return fresh;
  } catch (e) {
    if (e instanceof CloudError) remember(id, null);
    return null;
  }
}

/** A JPEG poster from the exported video (at 1 s, or its middle when shorter). */
async function poster(blob: Blob, duration: number): Promise<Blob | null> {
  try {
    const track = await new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) }).getPrimaryVideoTrack();
    if (!track) return null;
    const height = Math.min(720, track.displayHeight);
    const width = Math.round((height * track.displayWidth) / track.displayHeight);
    const sink = new CanvasSink(track, { width, height, fit: "fill", poolSize: 1 });
    const frame = await sink.getCanvas(Math.min(duration, 2) / 2);
    if (!frame) return null;
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(frame.canvas, 0, 0);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  } catch {
    return null;
  }
}

async function put(url: string, body: Blob, type: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { method: "PUT", body, headers: { "content-type": type } });
      if (r.ok) return r.headers.get("etag") ?? "";
      if (r.status < 500 || attempt === 2) throw new CloudError("Upload failed. Check your connection and try again.");
    } catch (e) {
      if (e instanceof CloudError || attempt === 2) throw e instanceof CloudError ? e : new CloudError("Upload failed. Check your connection and try again.");
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
}

type RawLink = { video: Video; raw: { partSize: number; thumbnailUrl?: string } };

/**
 * Like the Mac app: the recording itself goes up (no video is made in this browser), with its edit,
 * and the viewer's browser draws the look. The plan is checked first, so a long recording on Free
 * is told at once; the link is copied as soon as it exists.
 */
export async function shareStart(session: Session, id: string, title: string, cursor: unknown, progress: Progress<ShareProgress>): Promise<Video> {
  if (!sessionToken()) throw new CloudError("Sign in to share links.");
  const send = (stage: string, value: number, video?: Video) => progress.onmessage({ stage, value, video });
  const screen = session.file("screen.webm");
  if (!screen) throw new CloudError("The recording's file is missing.");
  const camera = session.hasCamera ? session.file("camera.webm") : null;
  const durationMs = Math.round(session.wasm.duration() * 1000);
  const link = await call<RawLink>("POST", "/api/videos", {
    raw: true,
    title,
    camera: !!camera,
    durationMs,
    contentType: screen.type.includes("mp4") ? "video/mp4" : "video/webm",
  });
  // Sharing it applies the plan (length, number of links) before anything is uploaded.
  let shared: Video;
  try {
    shared = (await call<{ video: Video }>("PATCH", `/api/videos/${link.video.id}`, { shared: true })).video;
  } catch (e) {
    await call("DELETE", `/api/videos/${link.video.id}`).catch(() => {});
    throw e;
  }
  remember(id, shared);
  void navigator.clipboard?.writeText(shared.url).catch(() => {});
  send("link", 0, shared);

  const total = screen.size + (camera?.size ?? 0);
  let sent = 0;
  const upload = async (file: "screen" | "camera", blob: Blob) => {
    const size = link.raw.partSize;
    const count = Math.max(1, Math.ceil(blob.size / size));
    const numbers = Array.from({ length: count }, (_, i) => i + 1);
    const etags: { partNumber: number; etag: string }[] = [];
    // URLs a hundred at a time, parts three at a time.
    for (let k = 0; k < numbers.length; k += 100) {
      const { parts } = await call<{ parts: { partNumber: number; url: string }[] }>("POST", `/api/videos/${link.video.id}/raw/parts`, { file, partNumbers: numbers.slice(k, k + 100) });
      const queue = [...parts];
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          for (let part = queue.shift(); part; part = queue.shift()) {
            const chunk = blob.slice((part.partNumber - 1) * size, part.partNumber * size);
            etags.push({ partNumber: part.partNumber, etag: await put(part.url, chunk, blob.type || "video/webm") });
            sent += chunk.size;
            send("upload", (sent / total) * 0.97);
          }
        }),
      );
    }
    etags.sort((a, b) => a.partNumber - b.partNumber);
    const [width, height] = file === "screen" ? session.wasm.frameSize(0, 1080) : [0, 0];
    await call("POST", `/api/videos/${link.video.id}/raw/complete`, { file, parts: etags, durationMs, width, height });
  };
  await upload("screen", screen);
  if (camera) await upload("camera", camera);

  const image = await poster(screen, session.wasm.duration());
  if (image && link.raw.thumbnailUrl) await put(link.raw.thumbnailUrl, image, "image/jpeg").catch(() => "");
  await sendImages(session, link.video.id);
  await call("PUT", `/api/videos/${link.video.id}/raw/edit`, { project: JSON.parse(session.wasm.project()), cursor: cursor ?? undefined });
  const done = (await call<{ video: Video }>("GET", `/api/videos/${link.video.id}`)).video;
  remember(id, done);
  send("done", 1, done);
  return done;
}

/** Images the edit names (background, overlays), from this browser's copy of the recording. */
async function sendImages(session: Session, linkId: string) {
  const edit = JSON.parse(session.wasm.project()).edit ?? {};
  const names: unknown[] = [edit.background?.image?._0, ...(edit.overlays ?? []).filter((o: { kind?: string }) => o.kind === "image").map((o: { file: string }) => o.file)];
  for (const name of names) {
    if (typeof name !== "string") continue;
    const blob = session.file(name);
    if (!blob || !/^image\/(jpeg|png)$/.test(blob.type)) continue;
    await fetch(`${apiBase()}/api/videos/${linkId}/raw/asset?name=${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${sessionToken()}`, "content-type": blob.type },
      body: blob,
    }).catch(() => {});
  }
}

/** The edit changed: a link made from this recording shows the new look (just the edit goes up). */
export async function syncEdit(session: Session, id: string) {
  const video = saved(id);
  if (!video || video.kind !== "raw") return;
  await sendImages(session, video.id);
  await call("PUT", `/api/videos/${video.id}/raw/edit`, { project: JSON.parse(session.wasm.project()) }).catch(() => {});
}

export async function shareUpdate(id: string, settings: Record<string, unknown>): Promise<Video> {
  const video = saved(id);
  if (!video) throw new CloudError("Not shared yet.");
  const updated = (await call<{ video: Video }>("PATCH", `/api/videos/${video.id}`, settings)).video;
  remember(id, updated);
  return updated;
}

export async function shareDelete(id: string): Promise<void> {
  const video = saved(id);
  if (video) await call("DELETE", `/api/videos/${video.id}`);
  remember(id, null);
}

export async function shareInsights(id: string): Promise<unknown> {
  const video = saved(id);
  if (!video) return null;
  // Insights are part of Pro: on Free there's simply nothing to show.
  return call<unknown>("GET", `/api/videos/${video.id}/insights`).catch(() => null);
}
