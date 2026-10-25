// Importing Loom videos from the web app: Loom doesn't let other sites read its answers
// (no CORS), so the editor asks through here. Signed-in accounts only, Loom addresses only.
import type { AppEnv } from "./env";
import { HttpError } from "./http";

const LOOM_ID = /^[0-9a-f]{32}$/;
const ENDPOINTS = new Set(["transcoded-url", "raw-url"]);

/** Hosts this may fetch from: Loom and its media hosts. */
function allowed(url: URL) {
  return url.protocol === "https:" && (url.hostname === "loom.com" || url.hostname.endsWith(".loom.com"));
}

export async function handleLoom(request: Request, _env: AppEnv, path: string): Promise<Response> {
  // POST /api/loom/<id>/<transcoded-url|raw-url>: the player endpoint (the video's address).
  const api = /^\/api\/loom\/([0-9a-f]+)\/([a-z-]+)$/.exec(path);
  if (api && request.method === "POST") {
    const [, id, endpoint] = api;
    if (!LOOM_ID.test(id!) || !ENDPOINTS.has(endpoint!)) throw new HttpError(400, "bad_request", "Not a Loom video.");
    const r = await fetch(`https://www.loom.com/api/campaigns/sessions/${id}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonID: null, deviceID: null, force_original: false, password: null }),
    });
    return new Response(r.status === 200 ? r.body : null, { status: r.status, headers: { "content-type": "application/json" } });
  }
  // GET /api/loom/oembed?id=…: the title.
  if (path === "/api/loom/oembed" && request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!LOOM_ID.test(id)) throw new HttpError(400, "bad_request", "Not a Loom video.");
    const r = await fetch(`https://www.loom.com/v1/oembed?url=https://www.loom.com/share/${id}`);
    return new Response(r.ok ? r.body : "{}", { headers: { "content-type": "application/json" } });
  }
  // GET /api/loom/fetch?url=…: a playlist, segment or MP4 on Loom's hosts, streamed.
  if (path === "/api/loom/fetch" && request.method === "GET") {
    let url: URL;
    try {
      url = new URL(new URL(request.url).searchParams.get("url") ?? "");
    } catch {
      throw new HttpError(400, "bad_request", "Bad address.");
    }
    if (!allowed(url)) throw new HttpError(400, "bad_request", "Only Loom addresses.");
    const r = await fetch(url.toString(), { redirect: "follow" });
    if (!allowed(new URL(r.url || url.toString()))) throw new HttpError(400, "bad_request", "Only Loom addresses.");
    const headers = new Headers();
    for (const h of ["content-type", "content-length"]) {
      const v = r.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(r.body, { status: r.status, headers });
  }
  throw new HttpError(404, "not_found", "Not found.");
}
