# Umi web — cloud sharing backend + viewer

Cloudflare Worker that stores videos in **R2** (no egress fees), metadata in **D1**, and serves the public
viewer page at `/v/:id`. Cloud sharing is the only paid feature of Umi, so every upload goes through an
`isPaid` hook (`canShareToCloud` in [src/auth.ts](src/auth.ts)).

```
src/
  index.ts     router + cron entry
  api.ts       owner API (create / complete / get / list / update / delete)
  uploads.ts   upload URL signing (direct-to-R2 presigned, or proxied through the Worker)
  page.ts      shared HTML shell (CSP, styles, icons) for viewer + embed
  viewer.ts    /v/:id HTML page (player, reactions, comments), password unlock
  embed.ts     /e/:id chrome-less iframe player + /oembed
  social.ts    viewer comments + emoji reactions (validation, rate limits, owner moderation)
  media.ts     range-capable video, thumbnail and GIF preview streaming
  access.ts    expiry / password / revoked checks shared by page and media
  auth.ts      email + password sign-up/sign-in (per-device sessions), bearer auth, paid-plan hook
  cleanup.ts   hourly purge of stale uploads and long-expired links
migrations/    D1 schema
seed/dev.sql   local dev accounts
scripts/e2e.mjs  end-to-end test (upload → play → comments/reactions → embed/oEmbed → password → expiry → revoke)
```

## Local development

Requires Node 20+ and (for the e2e sample video) `ffmpeg`. Everything runs locally in workerd/Miniflare;
no Cloudflare account is needed.

```bash
cd web
npm install
cp .dev.vars.example .dev.vars   # SIGNING_SECRET for local dev
npm run setup:local              # apply D1 migrations + seed dev accounts (local only)
npm run dev                      # wrangler dev → http://localhost:8787
```

In another terminal:

```bash
npm run e2e                      # or: node scripts/e2e.mjs --base http://localhost:8799 --file my.mp4 --thumb my.jpg
npm run typecheck
```

The e2e script prints a viewer URL; open it in a browser to watch the uploaded video.

Seeded tokens (local only): `umi_dev_token` (paid account), `umi_free_token` (unpaid → `402`).
Local R2/D1 state lives in `.wrangler/state`; delete it to start over.

## Deploy

CI deploys staging and production (`.github/workflows/deploy-cloud.yml`); the one-time setup is in
[docs/DEVOPS.md](../docs/DEVOPS.md). By hand:

```bash
npx wrangler login
npx wrangler r2 bucket create umi-videos
npx wrangler d1 create umi                 # put the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply umi --remote
openssl rand -base64 32 | npx wrangler secret put SIGNING_SECRET
npx wrangler deploy
```

Then:

- Route `umi.cam/v/*` and `umi.cam/api/*` (or a subdomain such as `share.umi.cam`) to the Worker and set
  `PUBLIC_BASE_URL` in `wrangler.jsonc`.
- **Direct uploads (recommended in production):** create an R2 API token with Object Read & Write on the
  bucket, set `R2_S3_ENDPOINT` (`https://<account_id>.r2.cloudflarestorage.com`) and the secrets
  `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. Upload URLs then become SigV4-presigned R2 URLs and bytes skip
  the Worker. Without them, URLs point at the Worker (`/api/uploads/...`), which streams parts into R2 — that's
  what local dev uses and it works in production too, within the Worker request-body limit (100 MB on
  Free/Pro, hence the 10 MiB part size). The direct mode has not been exercised locally because Miniflare
  has no S3 endpoint.
- Accounts: insert rows into `accounts` (`token_hash` = hex SHA-256 of the token, `is_paid` = 1) until real
  sign-in and billing exist — see the `TODO(accounts)` / `TODO(billing)` notes in `src/auth.ts`.

## API contract (for the macOS app)

All `/api/videos*` calls need `Authorization: Bearer <token>`. Timestamps are ISO 8601 strings. Errors are

```json
{ "error": { "code": "payment_required", "message": "Cloud sharing requires an Umi Cloud plan." } }
```

| Status | `code` examples |
|---|---|
| 400 | `invalid_json`, `invalid_field`, `complete_failed`, `invalid_gif` |
| 401 | `unauthorized`, `locked` (viewer endpoints on a password-protected video without unlock cookie) |
| 402 | `payment_required` (account has no cloud plan) |
| 403 | `url_expired`, `bad_signature` (upload URLs), `comments_disabled` |
| 404 | `not_found` |
| 409 | `not_uploading`, `upload_mismatch`, `processing` |
| 410 | `expired`, `gone` (viewer endpoints) |
| 413 | `too_large`, `part_too_large` |
| 415 | `unsupported_media_type` (viewer POSTs must be `application/json`) |
| 429 | `rate_limited` |
| 501 | `not_implemented` (`/oembed` with a format other than json) |

### Video object

```json
{
  "id": "3gqMye6PP6GW",
  "url": "https://umi.cam/v/3gqMye6PP6GW",
  "title": "Bug repro",
  "status": "uploading | ready",
  "contentType": "video/mp4",
  "sizeBytes": 12495012,
  "durationMs": 20000,
  "width": 1920,
  "height": 1080,
  "thumbnailUrl": "https://umi.cam/v/3gqMye6PP6GW/thumbnail.jpg",
  "previewGifUrl": "https://umi.cam/v/3gqMye6PP6GW/preview.gif",
  "embedUrl": "https://umi.cam/e/3gqMye6PP6GW",
  "allowDownload": true,
  "allowComments": true,
  "hasPassword": false,
  "expiresAt": "2026-11-01T00:00:00.000Z",
  "expired": false,
  "createdAt": "2026-10-23T17:50:00.000Z",
  "updatedAt": "2026-10-23T17:50:04.000Z"
}
```

### `POST /api/videos` — start an upload

```json
{
  "title": "Bug repro",
  "sizeBytes": 12495012,
  "contentType": "video/mp4",
  "durationMs": 20000,
  "width": 1920,
  "height": 1080,
  "allowDownload": true,
  "allowComments": true,
  "password": "optional, 4–128 chars",
  "expiresAt": "2026-11-01T00:00:00Z"
}
```

Only `sizeBytes` is required (`allowComments` defaults to `true`). `201`:

```json
{
  "video": { "...": "Video object, status 'uploading'" },
  "upload": {
    "uploadId": "…",
    "partSize": 10485760,
    "partCount": 2,
    "parts": [
      { "partNumber": 1, "url": "https://…" },
      { "partNumber": 2, "url": "https://…" }
    ],
    "thumbnailUrl": "https://…",
    "gifUrl": "https://…",
    "urlsExpireAt": "2026-10-23T23:50:00.000Z"
  }
}
```

The share link (`video.url`) is known immediately, so the app can copy it to the clipboard while the upload
runs; the page shows "Still uploading…" and auto-refreshes until it's ready.

### Upload the bytes

- Part *n* = bytes `[(n-1)·partSize, n·partSize)` of the MP4. `PUT` the raw bytes to its URL (no auth header)
  and keep the response's `ETag` header. Parts can be uploaded in parallel and retried individually.
- Optionally `PUT` a JPEG (≤ 5 MB, e.g. 1280 px wide) to `thumbnailUrl`. It's used as poster and OG image.
- Optionally `PUT` an animated GIF (≤ 10 MB; suggested: 3–5 s, ~480 px wide, 10–12 fps) to `gifUrl`. It becomes
  `video.previewGifUrl` (`/v/:id/preview.gif`) for embedding in emails/Slack/README files, e.g.
  `<a href="{url}"><img src="{previewGifUrl}"></a>`. Must start with `GIF87a`/`GIF89a` (else `400 invalid_gif`;
  for direct-to-R2 uploads the check happens at `complete`, and a non-GIF is silently dropped).
- Both images must be uploaded **before** `complete` (like the thumbnail, the slot is closed afterwards → `409`).
  Without a GIF, `previewGifUrl` is `null`.

### `POST /api/videos/:id/upload-urls` — resume

Body (optional): `{ "partNumbers": [2, 3] }`. Returns the same `{ video, upload }` shape with fresh URLs (all
parts if omitted). Use it after URLs expire or the app restarts mid-upload. Uploads that are not completed
within 24 h are aborted by the cron job.

### `POST /api/videos/:id/complete`

```json
{ "parts": [ { "partNumber": 1, "etag": "\"a1b2…\"" }, { "partNumber": 2, "etag": "\"c3d4…\"" } ] }
```

`200` → `{ "video": Video }` with `status: "ready"`. Idempotent once ready.

### `GET /api/videos/:id` · `GET /api/videos`

`{ "video": Video }` · `{ "videos": [Video] }` (newest first, max 200).

### `PATCH /api/videos/:id` — change link settings

Any subset of:

```json
{ "title": "New title", "allowDownload": false, "allowComments": false, "password": "secret" , "expiresAt": "2026-12-01T00:00:00Z" }
```

`"allowComments": false` hides existing comments from viewers and rejects new ones (`403 comments_disabled`);
turning it back on shows them again. Reactions are unaffected.

`"password": null` (or `""`) removes the password; `"expiresAt": null` removes the expiry. Changing or removing
the password signs out every viewer who unlocked with the old one. Expired links keep their files for 7 days,
so extending `expiresAt` brings them back; after that the cron job deletes them. → `{ "video": Video }`

### `DELETE /api/videos/:id` — revoke

Deletes the files (video, thumbnail, GIF) and all comments/reactions immediately; the link shows "This video was
removed" (`410`). → `{ "ok": true }`

### `GET /api/videos/:id/comments` — owner view of comments

Includes comments while commenting is turned off. → 

```json
{
  "comments": [
    { "id": "Xb2…", "authorName": "Ada", "body": "Bug shows up here", "timeMs": 4200, "createdAt": "2026-10-24T10:00:00.000Z" }
  ],
  "reactionCounts": { "👍": 2, "❤️": 1, "😂": 0, "😮": 0, "🎉": 0, "👏": 0 }
}
```

`timeMs` is `null` for comments not pinned to a time. Comments are oldest first (max 1000).

### `DELETE /api/videos/:id/comments/:commentId` — remove a comment

Soft-deletes it (hidden everywhere). → `{ "ok": true }`; `404` if it doesn't exist or was already deleted.

### Viewer endpoints (comments & reactions)

Public, no bearer token. Same access rules as the player: a password-protected video needs the unlock cookie
(`401 locked`), expired/revoked → `410`, still uploading → `409`. POSTs must send `Content-Type: application/json`
(`415` otherwise — this forces a CORS preflight, which is never approved, so other sites can't post on a
viewer's behalf).

| Endpoint | Body | Response |
|---|---|---|
| `GET /v/:id/comments` | | `{ "allowComments": true, "comments": [Comment] }` (empty list when turned off) |
| `POST /v/:id/comments` | `{ "authorName": "Ada", "body": "Nice!", "timeMs": 4200 }` | `201 { "comment": Comment }` |
| `GET /v/:id/reactions` | | `{ "counts": { "👍": 2, … }, "reactions": [ { "emoji": "👍", "timeMs": 1500 } ] }` |
| `POST /v/:id/reactions` | `{ "emoji": "🎉", "timeMs": 12000 }` | `201 { "reaction": { "emoji", "timeMs", "createdAt" }, "counts": { … } }` |

- `authorName`: required, 1–60 characters after trimming (control characters stripped). `body`: required,
  1–2000 characters (newlines kept). `timeMs`: optional for comments, required for reactions; a non-negative
  number no later than the video's `durationMs` + 1 s. All text is stored and returned verbatim and rendered
  with `textContent` only.
- `emoji` must be one of 👍 ❤️ 😂 😮 🎉 👏 (`400` otherwise). `reactions` (timeline markers) holds the newest 500.
- Rate limits per client IP **per video**, counted from D1 (the IP is stored only as an HMAC in `ip_hash`):
  10 comments / 10 min, 30 reactions / min → `429 rate_limited`. The count-then-insert is not atomic, so
  parallel bursts can overshoot slightly; put a Workers Rate Limiting binding or Turnstile in front for real
  abuse protection.
- The cron cleanup and `DELETE /api/videos/:id` remove a video's comments and reactions.

### Embedding

| Path | |
|---|---|
| `GET /e/:id` | Chrome-less player for `<iframe>`s (video fills the frame, poster = thumbnail, `?t=` honored). Framable by any site (`frame-ancestors *`, no `X-Frame-Options`); `/v/:id` stays `DENY`. Password-protected videos show the unlock form inside the frame. |
| `GET /oembed?url=<share or embed URL>&format=json[&maxwidth=&maxheight=]` | oEmbed 1.0 `video` (CORS `*`). |

```json
{
  "version": "1.0", "type": "video", "provider_name": "Umi", "provider_url": "https://umi.cam",
  "title": "Bug repro", "width": 1280, "height": 720,
  "html": "<iframe src=\"https://umi.cam/e/3gqMye6PP6GW\" width=\"1280\" height=\"720\" frameborder=\"0\" allow=\"autoplay; fullscreen; picture-in-picture\" allowfullscreen title=\"Bug repro\"></iframe>",
  "thumbnail_url": "https://umi.cam/v/3gqMye6PP6GW/thumbnail.jpg", "thumbnail_width": 1280, "thumbnail_height": 720,
  "cache_age": 3600
}
```

Width/height follow the video's aspect ratio (default 16:9), capped at 1280 and at `maxwidth`/`maxheight`. A
`?t=` on the passed URL is carried into the iframe `src`. Password-protected videos get a generic title and no
thumbnail; unknown, foreign-origin, expired or removed URLs → `404`; `format=xml` → `501`. Public `/v/:id` pages
advertise it with `<link rel="alternate" type="application/json+oembed">`.

Embed unlocks set the cookie with `Path=/` and, on HTTPS, `SameSite=None; Secure; Partitioned` (CHIPS) so it
works inside third-party iframes; browsers that block even partitioned cookies can use the "Open on Umi" link.

## Viewer

| Path | |
|---|---|
| `GET /v/:id` | Player page. `?t=90`, `?t=1:30` or `?t=1m30s` starts at that time. States: player, password prompt, still uploading (`202`), expired (`410`), removed (`410`), not found (`404`). |
| `POST /v/:id/unlock` | Password form target; sets an HttpOnly cookie scoped to `/v/:id` for 24 h. |
| `GET /v/:id/video.mp4` | Range-capable MP4 stream. `?download=1` adds `Content-Disposition: attachment` (only when `allowDownload`). |
| `GET /v/:id/thumbnail.jpg` | Poster / OG image (hidden while the video is password-protected). |
| `GET /v/:id/preview.gif` | Animated preview (`404` while password-protected without unlock, or when none was uploaded). Cached like the thumbnail (`public, max-age` ≤ 1 h and ≤ time to expiry; `private` for password videos), ETag/`304`. |
| `GET/POST /v/:id/comments`, `GET/POST /v/:id/reactions` | See *Viewer endpoints* above. |
| `GET /e/:id`, `GET /oembed` | See *Embedding* above. |

Player: native controls plus speed (0.5–2×, remembered per browser), fullscreen (iOS falls back to native
fullscreen), "Copy link" and "Copy at 0:42" (link with `?t=` at the current time), download button. Under the
video: a timeline strip with Loom-style emoji/comment markers (click to seek), the reaction bar (👍 ❤️ 😂 😮 🎉 👏,
with counts and a floating-emoji animation), and comments (name remembered in `localStorage`, optional "at 0:42"
time pin that seeks when clicked, relative times, refreshed every 30 s). Comments and reactions are inlined in the
page as JSON (`<` escaped) and rendered with `textContent` only. Keys: `k`/space play-pause, `f` fullscreen,
`<`/`>` speed, ←/→ seek 5 s. Light/dark follows the system. Public videos get `og:image`, `og:video` and
`twitter:card=summary_large_image`; password-protected ones unfurl with a generic title and no image.
Pages are `noindex` and served with a strict nonce-based CSP.
