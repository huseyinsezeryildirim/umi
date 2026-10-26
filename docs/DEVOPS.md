# DevOps: accounts, secrets, deploys and releases

Everything is automated in `.github/workflows/`. Until a step below is done, the workflow that needs it
**skips with a warning** (deploys) or **builds unsigned** (releases) instead of failing.

| Workflow | When | What |
|---|---|---|
| `ci.yml` | every push and PR | build + test on macOS, Windows, Linux; typecheck + build the web |
| `deploy-site.yml` | push to `main` → **staging**; tag `v*` → **production** | wasm engine + web editor + Next.js export → Cloudflare Pages |
| `release.yml` | tag `v*` | signed installers for macOS (arm64, Intel), Windows, Linux → **draft** GitHub release + `latest.json` |
| `health.yml` | every 3 hours | `/healthz` on staging and production; opens an issue on failure, closes it on recovery |
| `dependabot.yml` | monthly | one grouped minor/patch PR each for cargo, pnpm and GitHub Actions |

Both deploy workflows can also be run by hand (Actions → the workflow → **Run workflow** → staging or production).

## 1. Accounts to create

| Account | Cost | Needed for |
|---|---|---|
| **Cloudflare** (add the `umi.cam` zone) | Free to start; **Workers Paid $5/mo** recommended for production (CPU limits, D1 Time Travel 30 days) | Worker, D1, R2, Pages |
| **Apple Developer Program** | $99/year | Developer ID signing + notarization of the Mac app |
| **Azure Trusted Signing** (now also called *Artifact Signing*) | Basic ≈ $9.99/month | Signing the Windows installer (no SmartScreen warning) |
| GitHub | already there | Actions, Releases (installers and updates are served from here) |

The site host is **Cloudflare Pages** (the site is a static export; same account and bill as the backend).
Pages serves files up to 25 MiB; the one bigger file (onnxruntime's wasm) is automatically replaced by a
hash-checked redirect to the identical npm file on jsDelivr (`apps/site/scripts/pages-large-files.mjs`).

## 2. Cloudflare, once (on your Mac)

```bash
npx wrangler login

# The site.
npx wrangler pages project create umi-site --production-branch main
```

Umi Cloud (the share-link Worker, its D1 database, R2 storage and secrets) lives in its own private
repository, `umi-cloud`, cloned into `web/` for local development; its `DEPLOY.md` has those steps.

Then in the Cloudflare dashboard:

- **Pages → umi-site → Custom domains**: add `umi.cam`. Production routes `umi.cam/v/*`, `/e/*`, `/api/*`,
  `/oembed*` and `/healthz` to the Worker (see `env.production.routes` in the umi-cloud repository's `wrangler.jsonc`); everything
  else is the site. Staging lives on `umi-web-staging.<your-subdomain>.workers.dev` and
  `staging.umi-site.pages.dev`.
- **My Profile → API Tokens → Create token** ("Edit Cloudflare Workers" template), with these permissions:
  Account · Workers Scripts · Edit, Account · D1 · Edit, Account · Cloudflare Pages · Edit,
  Account · Account Settings · Read, Zone (umi.cam) · Workers Routes · Edit. This is `CLOUDFLARE_API_TOKEN`.
  The account id is on the dashboard's right sidebar: `CLOUDFLARE_ACCOUNT_ID`.

## 3. GitHub settings

**Settings → Environments**: create `staging` and `production`. On `production` turn on **Required reviewers**
(you) and limit **Deployment branches and tags** to tags `v*` and `main`. Production deploys then wait for
your approval, from a tag or a manual run.

**Settings → Secrets and variables → Actions → Secrets** (repository secrets):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | from step 2 (can also go on each environment instead) |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater key, step 4 |
| `APPLE_CERTIFICATE` | `base64 -i DeveloperID.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the password you gave the .p12 export |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Huseyin Sezer Yildirim (TEAMID)` (`security find-identity -v -p codesigning`) |
| `APPLE_ID` | your Apple Account email |
| `APPLE_PASSWORD` | an **app-specific password** from account.apple.com → Sign-In and Security |
| `APPLE_TEAM_ID` | the 10-character team id (developer.apple.com → Membership) |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` | the app registration from step 6 |
| `UMI_PEXELS_KEY` | optional: the Pexels key baked into builds (same as `keys.env` locally) |

**Variables** tab (repository variables, not secret):

| Variable | Example |
|---|---|
| `STAGING_API_URL` | `https://umi-web-staging.<subdomain>.workers.dev` |
| `PRODUCTION_API_URL` | `https://umi.cam` |
| `PAGES_PROJECT` | `umi-site` (the default; only if you named it differently) |
| `AZURE_SIGNING_ENDPOINT` | `https://weu.codesigning.azure.net` (your account's region) |
| `AZURE_SIGNING_ACCOUNT` | the Trusted Signing account name |
| `AZURE_CERTIFICATE_PROFILE` | the certificate profile name |

## 4. Updater key (auto-update)

```bash
pnpm --filter @umi/desktop tauri signer generate -w ~/.tauri/umi.key
```

- Put the contents of `~/.tauri/umi.key.pub` into `plugins.updater.pubkey` in
  `apps/desktop/src-tauri/tauri.conf.json` and commit it.
- Put the contents of `~/.tauri/umi.key` into the `TAURI_SIGNING_PRIVATE_KEY` secret and its password into
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back the key up in your password manager: **if it's lost, installed
  apps can never update again.**

Installed apps check `https://github.com/huseyinsezeryildirim/umi/releases/latest/download/latest.json` five seconds
after launch and show "Umi x.y.z is available → Restart to update". Release assets have to be publicly
downloadable for that, and for the download buttons on the site (`apps/site/components/Download.tsx`),
which point at the same repository: publish the code at `github.com/huseyinsezeryildirim/umi` (public), or change both
URLs if releases come from somewhere else.

## 5. Apple (macOS signing + notarization)

1. Enroll at developer.apple.com/programs ($99/year, approval takes a day or two).
2. Xcode → Settings → Accounts → your team → **Manage Certificates → + → Developer ID Application**.
3. Keychain Access → My Certificates → right-click "Developer ID Application: …" → **Export** as .p12 with a
   password → the `APPLE_*` secrets above.

The release builds `Umi.app`, runs `apps/desktop/scripts/bundle-libs.py` (puts Homebrew's FFmpeg inside and
re-signs with the Developer ID and a secure timestamp), makes the DMG, notarizes it with `notarytool` and
staples the ticket. Local `pnpm build:mac` keeps using your Apple Development identity from `tauri.conf.json`.

## 6. Azure Trusted Signing (Windows)

1. portal.azure.com → create a subscription → search **Trusted Signing** (Artifact Signing) → create an
   account (Basic) in a region near you; its URI is `AZURE_SIGNING_ENDPOINT`.
2. **Identity validation** (individual or organization) → once approved, create a **Certificate profile**
   (Public Trust).
3. Microsoft Entra ID → **App registrations → New** → note client and tenant ids → **Certificates & secrets →
   New client secret**.
4. On the Trusted Signing account → **Access control (IAM) → Add role assignment → Trusted Signing
   Certificate Profile Signer** → the app registration.

The release installs `trusted-signing-cli` and Tauri signs `umi-desktop.exe` and the installer with it.

## 7. Cutting a release

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/package.json` and
   `Cargo.toml` (`[workspace.package] version`); the release fails if the tag doesn't match `tauri.conf.json`.
2. Commit, then tag and push:
   ```bash
   git tag v0.3.0
   git push origin main v0.3.0
   ```
3. Actions: `Release` builds the draft; `Deploy site` (and, in the umi-cloud repository, `Deploy Umi Cloud`) wait for your approval
   on the production environment → **Review deployments → Approve**.
4. Releases → the draft → download and try the installers → edit the notes → **Publish**. Publishing is
   what makes `latest.json` and the site's download links point at the new version.

## 8. Monitoring and backups

- **GitHub Actions minutes**: free on this public repository. The private umi-cloud repository runs only
  short Linux jobs (typecheck and deploy), well within the free 2,000 minutes a month.

- **Health**: `health.yml` probes `/healthz` every three hours and opens an issue titled "Health check failing: …".
  GitHub emails you about new issues if you watch the repository.
- **Billing alerts**: Cloudflare dashboard → **Manage Account → Billing → Billable usage / Budget alerts**:
  set a monthly budget alert; **Notifications → Add → Usage Based Billing** for Workers, R2 and D1.
  Also watch R2 storage under **R2 → Overview** (videos are the only thing that grows).
- **D1 backups**: Time Travel is always on (30 days on Workers Paid, 7 on Free). To restore:
  ```bash
  npx wrangler d1 time-travel info umi --env production --timestamp 2026-11-01T12:00:00Z
  npx wrangler d1 time-travel restore umi --env production --timestamp 2026-11-01T12:00:00Z
  ```
  For an off-site copy now and then: `npx wrangler d1 export umi --env production --remote --output umi.sql`.
- **R2**: the Worker's hourly cron deletes expired and revoked videos and aborts uploads that never
  finished; the lifecycle rule from step 2 is the safety net for multipart uploads.
- **Logs**: Workers → umi-web → **Logs** (observability is on in `wrangler.jsonc`), or `npx wrangler tail --env production`.
