import type { AppEnv } from "./env";
import { handleApi } from "./api";
import { cleanup } from "./cleanup";
import { HttpError, errorResponse, json } from "./http";
import { handleEmbed, handleOembed } from "./embed";
import { servePreviewGif, serveThumbnail, serveVideo } from "./media";
import { getComments, getReactions, postComment, postReaction } from "./social";
import { handleAssetUpload, handlePartUpload } from "./uploads";
import { handleUnlock, handleViewer } from "./viewer";

async function route(request: Request, env: AppEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  let m: RegExpExecArray | null;

  if (pathname === "/" && method === "GET") return Response.redirect("https://umi.cam", 302);
  if (pathname === "/healthz") return json({ ok: true });

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
  if ((m = /^\/e\/([0-9A-Za-z]+)\/?$/.exec(pathname)) && method === "GET") return handleEmbed(request, env, m[1]!);
  if (pathname === "/oembed" && method === "GET") return handleOembed(request, env);

  // Proxied upload targets (authorized by URL signature, not bearer token).
  if ((m = /^\/api\/uploads\/([0-9A-Za-z]+)\/parts\/(\d+)$/.exec(pathname)) && method === "PUT") {
    return handlePartUpload(request, env, m[1]!, Number(m[2]));
  }
  if ((m = /^\/api\/uploads\/([0-9A-Za-z]+)\/(thumbnail|gif)$/.exec(pathname)) && method === "PUT") {
    return handleAssetUpload(request, env, m[1]!, m[2] as "thumbnail" | "gif");
  }
  if (pathname.startsWith("/api/")) return handleApi(request, env, pathname);

  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err);
      console.error(err);
      return errorResponse(new HttpError(500, "internal", "Something went wrong."));
    }
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanup(env).then((r) => console.log("cleanup", r)));
  },
} satisfies ExportedHandler<AppEnv>;
