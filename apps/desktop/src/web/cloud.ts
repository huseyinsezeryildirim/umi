// Share links from the web editor, the same way the desktop app makes them: the video is drawn
// at 1080p30 (~4 Mb/s), uploaded in parts to Umi Cloud with a poster, and the link is copied as
// soon as it exists. Uses the website's sign-in (the same account and plan limits).
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { Session } from "./engine";
import { exportVideo } from "./exporter";

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

type Created = { video: Video; upload: { partSize: number; parts: { partNumber: number; url: string }[]; thumbnailUrl?: string } };

export async function shareStart(session: Session, id: string, title: string, progress: Progress<ShareProgress>): Promise<Video> {
  if (!sessionToken()) throw new CloudError("Sign in to share links.");
  const send = (stage: string, value: number, video?: Video) => progress.onmessage({ stage, value, video });
  send("export", 0);
  const blob = await exportVideo(
    session,
    { format: "mp4", resolution: 1080, fps: 30, bitrate: 4_000_000, destination: "share.mp4" },
    (v) => send("export", v),
    new AbortController().signal,
    null,
  );
  if (!blob) throw new CloudError("The video couldn't be made.");
  const duration = session.wasm.duration();
  const [width, height] = session.wasm.frameSize(0, 1080);

  const created = await call<Created>("POST", "/api/videos", {
    title,
    sizeBytes: blob.size,
    contentType: "video/mp4",
    durationMs: Math.round(duration * 1000),
    width,
    height,
    allowDownload: true,
  });
  remember(id, created.video);
  void navigator.clipboard?.writeText(created.video.url).catch(() => {});
  send("link", 0, created.video);

  const image = await poster(blob, duration);
  if (image && created.upload.thumbnailUrl) await put(created.upload.thumbnailUrl, image, "image/jpeg").catch(() => "");

  // Video parts, three at a time.
  const { partSize, parts } = created.upload;
  const queue = [...parts];
  const etags: { partNumber: number; etag: string }[] = [];
  let sent = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let part = queue.shift(); part; part = queue.shift()) {
        const chunk = blob.slice((part.partNumber - 1) * partSize, part.partNumber * partSize);
        etags.push({ partNumber: part.partNumber, etag: await put(part.url, chunk, "video/mp4") });
        sent += chunk.size;
        send("upload", (sent / blob.size) * 0.98);
      }
    }),
  );
  etags.sort((a, b) => a.partNumber - b.partNumber);
  const done = (await call<{ video: Video }>("POST", `/api/videos/${created.video.id}/complete`, { parts: etags })).video;
  remember(id, done);
  send("done", 1, done);
  return done;
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
