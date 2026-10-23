import { AwsClient } from "aws4fetch";
import { type AppEnv, MAX_THUMBNAIL_BYTES, UPLOAD_URL_TTL_MS, baseUrl, partSize, thumbnailKey, videoKey } from "./env";
import { hmacSign, hmacVerify } from "./crypto";
import { HttpError } from "./http";
import { type VideoRow, getVideo } from "./videos";

export interface UploadPlan {
  uploadId: string;
  /** Every part except the last must be exactly this many bytes. */
  partSize: number;
  partCount: number;
  /** PUT the raw bytes of each part to its URL and keep the `ETag` response header. */
  parts: { partNumber: number; url: string }[];
  /** PUT the JPEG bytes here (optional). */
  thumbnailUrl: string;
  /** All URLs stop working after this; call POST /api/videos/:id/upload-urls for fresh ones. */
  urlsExpireAt: string;
}

/**
 * Two signing modes:
 * - Direct: when R2 S3 credentials are configured, URLs are SigV4-presigned R2 URLs, so bytes never pass
 *   through the Worker (no Worker body-size limits, no CPU cost).
 * - Proxied (local dev / fallback): URLs point back at this Worker with an HMAC signature, and the Worker
 *   streams each part into R2 through the binding. Same client contract either way.
 */
export async function buildUploadPlan(
  env: AppEnv,
  request: Request,
  video: VideoRow,
  partNumbers?: number[],
): Promise<UploadPlan> {
  if (!video.upload_id) throw new HttpError(409, "not_uploading", "This video is not accepting uploads.");
  const size = partSize(env);
  const partCount = Math.max(1, Math.ceil(video.size_bytes / size));
  const wanted = (partNumbers ?? Array.from({ length: partCount }, (_, i) => i + 1)).filter(
    (n) => Number.isInteger(n) && n >= 1 && n <= partCount,
  );
  const exp = Date.now() + UPLOAD_URL_TTL_MS;
  const s3 = s3Client(env);

  const parts = await Promise.all(
    wanted.map(async (partNumber) => ({
      partNumber,
      url: s3
        ? await presignS3(env, s3, videoKey(video.id), exp, { partNumber: String(partNumber), uploadId: video.upload_id! })
        : await signProxyUrl(env, request, `/api/uploads/${video.id}/parts/${partNumber}`, exp, {
            uploadId: video.upload_id!,
          }),
    })),
  );
  const thumbnailUrl = s3
    ? await presignS3(env, s3, thumbnailKey(video.id), exp, {})
    : await signProxyUrl(env, request, `/api/uploads/${video.id}/thumbnail`, exp, {});

  return {
    uploadId: video.upload_id,
    partSize: size,
    partCount,
    parts,
    thumbnailUrl,
    urlsExpireAt: new Date(exp).toISOString(),
  };
}

function s3Client(env: AppEnv): AwsClient | null {
  const endpoint = env.R2_S3_ENDPOINT as string;
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

async function presignS3(
  env: AppEnv,
  client: AwsClient,
  key: string,
  exp: number,
  params: Record<string, string>,
): Promise<string> {
  const url = new URL(`${(env.R2_S3_ENDPOINT as string).replace(/\/+$/, "")}/${env.R2_BUCKET_NAME}/${key}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // SigV4 presigned URLs max out at 7 days.
  url.searchParams.set("X-Amz-Expires", String(Math.floor((exp - Date.now()) / 1000)));
  const signed = await client.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return signed.url;
}

const proxyMessage = (path: string, exp: number, params: Record<string, string>) =>
  `upload:${path}:${exp}:${Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`;

async function signProxyUrl(
  env: AppEnv,
  request: Request,
  path: string,
  exp: number,
  params: Record<string, string>,
): Promise<string> {
  const url = new URL(path, baseUrl(env, request));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", await hmacSign(env.SIGNING_SECRET, proxyMessage(path, exp, params)));
  return url.toString();
}

async function verifyProxyUrl(env: AppEnv, url: URL, params: Record<string, string>): Promise<void> {
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!exp || exp < Date.now()) throw new HttpError(403, "url_expired", "Upload URL expired; request new URLs.");
  if (!(await hmacVerify(env.SIGNING_SECRET, proxyMessage(url.pathname, exp, params), sig))) {
    throw new HttpError(403, "bad_signature", "Invalid upload URL signature.");
  }
}

async function uploadingVideo(env: AppEnv, id: string): Promise<VideoRow> {
  const video = await getVideo(env, id);
  if (!video || video.status !== "uploading" || !video.upload_id) {
    throw new HttpError(409, "not_uploading", "This video is not accepting uploads.");
  }
  return video;
}

/** PUT /api/uploads/:id/parts/:n — proxied multipart part upload. */
export async function handlePartUpload(request: Request, env: AppEnv, id: string, partNumber: number): Promise<Response> {
  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId") ?? "";
  await verifyProxyUrl(env, url, { uploadId });
  const video = await uploadingVideo(env, id);
  if (video.upload_id !== uploadId) throw new HttpError(409, "upload_mismatch", "Upload id does not match.");
  if (!request.body) throw new HttpError(400, "empty_body", "Part body is empty.");
  if (Number(request.headers.get("content-length")) > partSize(env)) {
    throw new HttpError(413, "part_too_large", "Part exceeds the part size.");
  }

  const upload = env.VIDEOS.resumeMultipartUpload(videoKey(id), uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return new Response(null, { status: 200, headers: { etag: `"${part.etag}"`, "cache-control": "no-store" } });
}

/** PUT /api/uploads/:id/thumbnail — proxied thumbnail upload. */
export async function handleThumbnailUpload(request: Request, env: AppEnv, id: string): Promise<Response> {
  await verifyProxyUrl(env, new URL(request.url), {});
  await uploadingVideo(env, id);
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) throw new HttpError(400, "empty_body", "Thumbnail body is empty.");
  if (body.byteLength > MAX_THUMBNAIL_BYTES) throw new HttpError(413, "too_large", "Thumbnail is too large.");
  const obj = await env.VIDEOS.put(thumbnailKey(id), body, { httpMetadata: { contentType: "image/jpeg" } });
  return new Response(null, { status: 200, headers: { etag: obj.httpEtag, "cache-control": "no-store" } });
}
