import { handleAdmin } from "./admin";
import { postReport } from "./reports";
import type { AppEnv } from "./env";
import { handleApi } from "./api";
import { handleAuth } from "./auth";
import { deleteAccount } from "./account";
import { cleanup } from "./cleanup";
import { HttpError, errorResponse, json } from "./http";
import { handleEmbed, handleOembed } from "./embed";
import { servePreviewGif, serveThumbnail, serveVideo } from "./media";
import { postView } from "./insights";
import { getComments, getReactions, postComment, postReaction, viewableVideo } from "./social";
import { handleAssetUpload, handlePartUpload } from "./uploads";
import { handleUnlock, handleViewer } from "./viewer";

async function route(request: Request, env: AppEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  let m: RegExpExecArray | null;

  if (pathname === "/" && method === "GET") return Response.redirect("https://umi.cam", 302);
  if (pathname === "/healthz") return json({ ok: true });
  if (pathname === "/adagiris" || pathname.startsWith("/adagiris/")) return handleAdmin(request, env, pathname);

  if ((m = /^\/v\/([0-9A-Za-z]+)\/?$/.exec(pathname)) && method === "GET") return handleViewer(request, env, m[1]!);
  if ((m = /^\/v\/([0-9A-Za-z]+)\/unlock$/.exec(pathname)) && method === "POST") return handleUnlock(request, env, m[1]!);
  if ((m = /^\/v\/([0-9A-Za-z]+)\/video\.mp4$/.exec(pathname)) && (method === "GET" || method === "HEAD")) {
    return serveVideo(request, env, m[1]!);
  }
  if ((m = /^\/v\/([0-9A-Za-z]+)\/thumbnail\.jpg$/.exec(pathname)) && method === "GET") {
    return serveThumbnail(request, env, m[1]!);
  }
  if ((m = /^\/v\/([0-9A-Za-z]+)\/preview\.gif$/.exec(pathname)) && method === "GET") {
    return servePreviewGif(request, env, m[1]!);
  }
  if ((m = /^\/v\/([0-9A-Za-z]+)\/comments$/.exec(pathname))) {
    if (method === "GET") return getComments(request, env, m[1]!);
    if (method === "POST") return postComment(request, env, m[1]!);
  }
  if ((m = /^\/v\/([0-9A-Za-z]+)\/reactions$/.exec(pathname))) {
    if (method === "GET") return getReactions(request, env, m[1]!);
    if (method === "POST") return postReaction(request, env, m[1]!);
  }
  if ((m = /^\/v\/([0-9A-Za-z]+)\/report$/.exec(pathname)) && method === "POST") return postReport(request, env, m[1]!);
  if ((m = /^\/v\/([0-9A-Za-z]+)\/view$/.exec(pathname)) && method === "POST") {
    return postView(request, env, await viewableVideo(request, env, m[1]!));
  }
  if ((m = /^\/e\/([0-9A-Za-z]+)\/?$/.exec(pathname)) && method === "GET") return handleEmbed(request, env, m[1]!);
  if (pathname === "/oembed" && method === "GET") return handleOembed(request, env);

  // Proxied upload targets (authorized by URL signature, not bearer token).
  if ((m = /^\/api\/uploads\/([0-9A-Za-z]+)\/parts\/(\d+)$/.exec(pathname)) && method === "PUT") {
    return handlePartUpload(request, env, m[1]!, Number(m[2]));
  }
  if ((m = /^\/api\/uploads\/([0-9A-Za-z]+)\/(thumbnail|gif)$/.exec(pathname)) && method === "PUT") {
    return handleAssetUpload(request, env, m[1]!, m[2] as "thumbnail" | "gif");
  }
  if (pathname === "/api/auth/account" && method === "DELETE") return deleteAccount(request, env);
  if (pathname.startsWith("/api/auth/")) {
    const response = await handleAuth(request, env, pathname);
    if (response) return response;
  }
  if (pathname.startsWith("/api/")) return handleApi(request, env, pathname);

  return new Response("Not found", { status: 404 });
}

/** Lets the configured site origins (SITE_ORIGINS, comma-separated) call the API. */
function withCors(request: Request, env: AppEnv, response: Response): Response {
  const origin = request.headers.get("origin");
  const allowed = String(env.SITE_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", "authorization, content-type");
  headers.set("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  // The web editor uploads parts and needs each part's ETag to complete the upload.
  headers.set("access-control-expose-headers", "etag");
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    // The website (another origin) calls the API with a bearer token, never cookies.
    if (request.method === "OPTIONS" && new URL(request.url).pathname.startsWith("/api/")) return withCors(request, env, new Response(null, { status: 204 }));
    let response: Response;
    try {
      response = await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) response = errorResponse(err);
      else {
        console.error(err);
        response = errorResponse(new HttpError(500, "internal", "Something went wrong."));
      }
    }
    return new URL(request.url).pathname.startsWith("/api/") ? withCors(request, env, response) : response;
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanup(env).then((r) => console.log("cleanup", r)));
  },
} satisfies ExportedHandler<AppEnv>;
