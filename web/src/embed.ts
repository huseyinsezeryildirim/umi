import { type AppEnv, baseUrl } from "./env";
import { resolveAccess } from "./access";
import { HttpError, json } from "./http";
import { CLOCK, LOGO, MISSING, PARSE_T_JS, esc, messageCard, newNonce, page, passwordCard } from "./page";
import type { VideoRow } from "./videos";

/** GET /e/:id — chrome-less player for iframes. Same access rules as /v/:id; framable by any site. */
export async function handleEmbed(request: Request, env: AppEnv, id: string, wrongPassword = false): Promise<Response> {
  const url = new URL(request.url);
  const origin = baseUrl(env, request);
  const canonical = `${origin}/v/${id}`;
  const nonce = newNonce();
  const access = await resolveAccess(request, env, id);
  const base = { canonical, nonce, variant: "embed" as const };
  const open = `<a class="open" href="/v/${esc(id)}" target="_blank" rel="noopener">Open on Umi ↗</a>`;

  switch (access.state) {
    case "not_found":
      return page({ ...base, status: 404, title: "Video not found", description: "This link doesn't exist.",
        body: messageCard(MISSING, "Video not found", "Check the link and try again.") });
    case "gone":
      return page({ ...base, status: 410, title: "Video removed", description: "This video is no longer available.",
        body: messageCard(MISSING, "This video was removed", "The owner deleted this video or revoked the link.") });
    case "expired":
      return page({ ...base, status: 410, title: "Link expired", description: "This video link has expired.",
        body: messageCard(CLOCK, "This link has expired", "Ask the sender for a new link.") });
    case "processing":
      return page({ ...base, status: 202, title: "Video uploading", description: "This video is still uploading.",
        headers: { refresh: "10" },
        body: messageCard(CLOCK, "Still uploading…", "This player refreshes automatically when the video is ready.") });
    case "locked":
      return page({ ...base, status: wrongPassword ? 401 : 200, title: "Password-protected video",
        description: "Enter the password to watch this video on Umi.",
        body: passwordCard(id, url.searchParams.get("t"), wrongPassword, true).replace("</section>", `${open}</section>`) });
    case "ok": {
      const v = access.video;
      return page({
        ...base,
        status: 200,
        title: v.title,
        description: "Watch on Umi",
        body: `${embedBody(v)}<script nonce="${nonce}">${EMBED_SCRIPT}</script>`,
      });
    }
  }
}

function embedBody(video: VideoRow): string {
  const poster = video.has_thumbnail ? ` poster="/v/${video.id}/thumbnail.jpg"` : "";
  return `<video id="video" src="/v/${video.id}/video.mp4" controls playsinline preload="metadata"${poster}></video>
<a class="badge" href="/v/${video.id}" target="_blank" rel="noopener">${LOGO}<span>${esc(video.title)}</span></a>`;
}

const EMBED_SCRIPT = `(() => {
  const v = document.getElementById("video"), main = document.querySelector("main");
  ${PARSE_T_JS}
  const start = parseT(new URLSearchParams(location.search).get("t"));
  if (start > 0) v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(start, v.duration || start); }, { once: true });
  const sync = () => main.classList.toggle("paused", v.paused);
  v.addEventListener("play", sync); v.addEventListener("pause", sync); sync();
})();`;

/** Fit `w × h` into the optional max box, keeping the aspect ratio. Defaults to the video size, capped at 1280. */
function fit(width: number | null, height: number | null, maxW: number | null, maxH: number | null) {
  const ratio = width && height ? height / width : 9 / 16;
  let w = Math.min(width ?? 1280, 1280, maxW ?? Infinity);
  let h = Math.round(w * ratio);
  if (maxH && h > maxH) {
    h = maxH;
    w = Math.round(h / ratio);
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, h) };
}

const positiveInt = (s: string | null) => {
  const n = s ? Number(s) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** GET /oembed?url=<share or embed URL>&format=json[&maxwidth=&maxheight=] — oEmbed 1.0 `video`. */
export async function handleOembed(request: Request, env: AppEnv): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "json";
  if (format !== "json") throw new HttpError(501, "not_implemented", "Only format=json is supported.");
  const origin = baseUrl(env, request);
  let target: URL;
  try {
    target = new URL(params.get("url") ?? "");
  } catch {
    throw new HttpError(404, "not_found", "Unknown URL.");
  }
  const m = /^\/[ve]\/([0-9A-Za-z]+)\/?$/.exec(target.pathname);
  if (target.origin !== origin || !m) throw new HttpError(404, "not_found", "Unknown URL.");
  const id = m[1]!;

  // Evaluated without the consumer's cookies: password-protected videos stay anonymous.
  const access = await resolveAccess(new Request(request.url), env, id);
  if (access.state !== "ok" && access.state !== "locked") throw new HttpError(404, "not_found", "Video not available.");
  const video = access.video;
  const locked = access.state === "locked";

  const { width, height } = fit(video.width, video.height, positiveInt(params.get("maxwidth")), positiveInt(params.get("maxheight")));
  const t = target.searchParams.get("t");
  const src = `${origin}/e/${id}${t ? `?t=${encodeURIComponent(t)}` : ""}`;
  const title = locked ? "Password-protected video" : video.title;
  const body: Record<string, unknown> = {
    version: "1.0",
    type: "video",
    provider_name: "Umi",
    provider_url: "https://umi.cam",
    title,
    width,
    height,
    html: `<iframe src="${esc(src)}" width="${width}" height="${height}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${esc(title)}"></iframe>`,
    cache_age: 3600,
  };
  if (!locked && video.has_thumbnail) {
    // Thumbnails are uploaded ~1280 px wide (README); report the video's aspect at that width.
    const thumb = fit(video.width, video.height, 1280, null);
    Object.assign(body, {
      thumbnail_url: `${origin}/v/${id}/thumbnail.jpg`,
      thumbnail_width: thumb.width,
      thumbnail_height: thumb.height,
    });
  }
  return json(body, 200, { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" });
}
