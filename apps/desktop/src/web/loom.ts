// Loom import in the browser, the same way the Mac app does it (player endpoint → MP4 or an
// HLS stream), asked through Umi's API because Loom doesn't answer other sites directly.
import { ALL_FORMATS, BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output } from "mediabunny";

import { apiBase as API, sessionToken as token } from "./cloud";

export const loomId = (link: string) => /loom\.com\/(?:share|embed)\/([0-9a-f]{32})/.exec(link)?.[1] ?? null;

async function api(path: string, init: RequestInit = {}) {
  const t = token();
  if (!t) throw new Error("Sign in to import from Loom.");
  return fetch(`${API()}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${t}` } });
}

/** A file on Loom's servers, through the API; `progress` gets 0…1 when the size is known. */
async function fetchLoom(url: string, progress?: (p: number) => void): Promise<Uint8Array> {
  const r = await api(`/api/loom/fetch?url=${encodeURIComponent(url)}`);
  if (!r.ok || !r.body) throw new Error(`Couldn't download from Loom (${r.status}).`);
  const total = Number(r.headers.get("content-length")) || 0;
  const parts: Uint8Array[] = [];
  let done = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    if (total) progress?.(done / total);
  }
  const out = new Uint8Array(done);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const text = async (url: string) => new TextDecoder().decode(await fetchLoom(url));

async function player(id: string, endpoint: "transcoded-url" | "raw-url"): Promise<Record<string, unknown> | null> {
  const r = await api(`/api/loom/${id}/${endpoint}`, { method: "POST" });
  if (r.status === 200) return r.json();
  if (r.status === 204 || r.status === 404) return null;
  if (r.status === 401 || r.status === 403) throw new Error("This Loom video is private or password-protected.");
  throw new Error(`Loom answered ${r.status}.`);
}

/** The best video rendition up to 1080p and the audio rendition of a master playlist. */
function pick(master: string): [string | null, string | null] {
  const lines = master.split("\n").map((l) => l.trim());
  let best: [number, string] | null = null;
  let fallback: [number, string] | null = null;
  lines.forEach((line, i) => {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) return;
    const height = Number(/RESOLUTION=\d+x(\d+)/.exec(line)?.[1] ?? 0);
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
    if (!uri) return;
    if (height <= 1080 && (!best || height > best[0])) best = [height, uri];
    if (!fallback || height < fallback[0]) fallback = [height, uri];
  });
  const audio = lines.filter((l) => l.startsWith("#EXT-X-MEDIA:") && l.includes("TYPE=AUDIO")).map((l) => /URI="([^"]+)"/.exec(l)?.[1]).find(Boolean) ?? null;
  const chosen = (best ?? fallback) as [number, string] | null;
  return [chosen ? chosen[1] : null, audio];
}

/** Joins MPEG-TS video and audio into one MP4, copying the encoded packets (no re-encoding). */
async function remux(video: Blob, audio: Blob | null): Promise<Blob> {
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const vin = new Input({ formats: ALL_FORMATS, source: new BlobSource(video) });
  const vtrack = await vin.getPrimaryVideoTrack();
  if (!vtrack) throw new Error("The Loom stream has no video.");
  const vcodec = await vtrack.getCodec();
  const vsrc = new EncodedVideoPacketSource(vcodec!);
  output.addVideoTrack(vsrc);
  const ain = audio ? new Input({ formats: ALL_FORMATS, source: new BlobSource(audio) }) : vin;
  const atrack = await ain.getPrimaryAudioTrack();
  const asrc = atrack ? new EncodedAudioPacketSource((await atrack.getCodec())!) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();
  const vconfig = await vtrack.getDecoderConfig();
  let first = true;
  for await (const packet of new EncodedPacketSink(vtrack).packets()) {
    await vsrc.add(packet, first ? { decoderConfig: vconfig! } : undefined);
    first = false;
  }
  if (atrack && asrc) {
    const aconfig = await atrack.getDecoderConfig();
    first = true;
    for await (const packet of new EncodedPacketSink(atrack).packets()) {
      await asrc.add(packet, first ? { decoderConfig: aconfig! } : undefined);
      first = false;
    }
  }
  await output.finalize();
  return new Blob([output.target.buffer!], { type: "video/mp4" });
}

/** Downloads a Loom share link's video; returns it with the video's title. */
export async function downloadLoom(link: string, progress: (p: number) => void): Promise<{ video: Blob; title: string }> {
  const id = loomId(link);
  if (!id) throw new Error("That doesn't look like a Loom link (loom.com/share/…).");
  const meta = await api(`/api/loom/oembed?id=${id}`).then((r) => r.json() as Promise<{ title?: string }>).catch(() => ({}) as { title?: string });
  const title = meta.title || `Loom ${id.slice(0, 8)}`;
  const transcoded = await player(id, "transcoded-url");
  // Older videos: one MP4.
  if (transcoded && !transcoded.part_credentials && typeof transcoded.url === "string") {
    const bytes = await fetchLoom(transcoded.url, (p) => progress(p * 0.95));
    return { video: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "video/mp4" }), title };
  }
  // Newer videos: an HLS stream (separate video and audio, signed segments).
  const raw = await player(id, "raw-url");
  if (!raw || typeof raw.url !== "string") throw new Error("Loom didn't give the video. Is it shared with “anyone with the link”?");
  const url = raw.url;
  const creds = (raw.part_credentials ?? {}) as Record<string, string>;
  const query = Object.entries(creds).map(([k, v]) => `${k}=${v}`).join("&");
  const sign = (u: string) => (!query || u.includes("Signature=") ? u : `${u}${u.includes("?") ? "&" : "?"}${query}`);
  const dir = (u: string) => u.split("?")[0].replace(/\/[^/]*$/, "");
  const resolve = (base: string, name: string) => sign(name.startsWith("http") ? name : `${dir(base)}/${name}`);
  const master = await text(url);
  const [videoList, audioList] = master.includes("#EXT-X-STREAM-INF") ? pick(master) : [url, null];
  if (!videoList) throw new Error("The Loom stream has no video.");
  const lists = await Promise.all(
    [videoList, audioList].filter((l): l is string => !!l).map(async (l) => {
      const listUrl = l === url ? url : resolve(url, l);
      const body = await text(listUrl);
      return { listUrl, segments: body.split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#")) };
    }),
  );
  const total = Math.max(1, lists.reduce((n, l) => n + l.segments.length, 0));
  let done = 0;
  const tracks: Blob[] = [];
  for (const { listUrl, segments } of lists) {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (const s of segments) {
      parts.push((await fetchLoom(resolve(listUrl, s))) as Uint8Array<ArrayBuffer>);
      progress((++done / total) * 0.9);
    }
    tracks.push(new Blob(parts, { type: "video/mp2t" }));
  }
  const video = await remux(tracks[0], tracks[1] ?? null);
  progress(0.97);
  return { video, title };
}
