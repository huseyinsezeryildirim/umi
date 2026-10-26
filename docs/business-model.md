# Umi: plans and how it makes money (proposal)

Status: proposal, waiting for a decision. The limits below are already wired into
`web/src/plans.ts` so they can be tried locally (account menu → "Testing: switch plan").
Changing a decision means changing that one table.

## The market (October 2026)

| | Free | Paid |
|---|---|---|
| **Loom** (Atlassian) | 25 videos, 5 min each, 720p | Business $18/user/month |
| **Cap** (open source) | Personal use only; share links up to 5 min | Desktop license $29/year for work; Pro $12/user/month ($8.16 billed yearly) |
| **Screen Studio** (Mac only) | none | $29/month, or $9/month billed yearly |

Revenue, as far as public numbers go:
- **Loom:** Atlassian bought it in 2023 for $975M. Estimates of its ARR then range from $35M to $50M. Later secondary sources say it passed $100M, but I couldn't confirm that.
- **Screen Studio:** the founder reported about $30k in its first month and thousands of paying users.
- **Cap:** no public revenue figure. It has 22k+ GitHub stars, and its paying users come from the work-use license and Pro.

What this says: people pay for **sharing and teams** (links, viewers, comments, insights,
workspaces), not for recording. Loom limits recording to push upgrades. Cap limits commercial use.
Both are where Umi can be more generous.

## What a share link costs (Cloudflare R2 + Workers, October 2026 prices)

Assumptions:
- A 1080p screen recording is about 30 MB per minute (~4 Mbps).
- A view makes about 10 range requests; each one is a Worker request plus an R2 read.
- Uploads go in 10 MB parts.

| | Cost |
|---|---|
| Storing 1 minute of video for a month | $0.00045 |
| Storing a 10-minute link for a month (a year) | $0.0045 ($0.054) |
| A free account full at 10 GB, per month | $0.15 |
| One view | $0.0000066 |
| 1 million views | $6.60 |
| Uploading a 10-minute video | $0.00015 |
| Fixed: Workers Paid (includes 10M requests) | $5 / month |

Prices behind the table:
- **R2:** $0.015 per GB-month, $4.50 per million writes, $0.36 per million reads. Viewing (egress) is free. The first 10 GB, 1M writes and 10M reads each month are free.
- **Workers:** $0.30 per million requests after the first 10 million.

Example: 10,000 free users with 2 GB each and 2 million views a month cost about **$318 a month, or
$0.03 per user**. 40 Pro subscriptions at $8 cover all of it.

What follows:
- **Storage is the only cost that matters, and it adds up over time.** Views and uploads are close to free, and video length only matters through the storage it uses. So Free limits storage, not length.
- **No server-side processing:** videos are rendered on the user's computer and AI runs there too, so there's no transcoding or GPU bill. That's what makes free sharing affordable.
- **Alternatives cost more:**
  - Cloudflare Stream charges per minute stored and per minute watched ($5 and $1 per 1,000 minutes). That's far more for the same videos.
  - S3 or GCS charge for every view through egress.
- **Keeping storage in check:**
  - Free accounts that haven't signed in for 12 months get two emails, then their videos are archived.
  - Abuse (hosting large or unrelated files) is caught by the 10 GB cap and the 5 GB per-file limit.

## Proposal

**Everything on the computer is free, for everyone, including work use.** That's the line Loom
and Cap don't cross.

| | **Free** | **Pro** — $8/month yearly ($10 monthly) | **Team** — $12/user/month yearly ($15 monthly) |
|---|---|---|---|
| Record (app and browser), any length, 4K | ✓ | ✓ | ✓ |
| Full editor, zooms, captions, cut the ums, camera blur | ✓ | ✓ | ✓ |
| Export MP4/GIF, your own storage | ✓ | ✓ | ✓ |
| Commercial use | ✓ | ✓ | ✓ |
| Share links on Umi Cloud | Unlimited links, **any length**, **10 GB** in total (about 5 hours of 1080p) | 1 TB | No limits |
| Views, reactions, comments, password, expiry | ✓ | ✓ | ✓ |
| "Made with Umi" on the share page | shown | removed | removed |
| Viewer insights (retention, countries, embeds) | | ✓ | ✓ |
| Your own domain for links, your logo | | ✓ | ✓ |
| Shared workspaces, admin, SSO later | | | ✓ |

Why these numbers:
- **Free beats both:** Loom gives 25 videos of 5 minutes at 720p. Cap's free tier is personal use only, with 5-minute links. Umi gives unlimited links of any length up to 10 GB, and unlimited local recording for any use. At most that costs Umi $0.15 a month per free user.
- **Pro is the cheapest paid plan:** it undercuts Cap Pro ($12) and Loom ($18). Most people never need more than Free, and that's fine: the free plan is the marketing.
- **Team is where the money is,** as with Loom. Companies pay per seat for shared libraries and admin.

Other income later, all optional:
- a one-time "supporter" license;
- paid hosting in the EU or a private region for companies.

## Open source, the way Cap does it

- **License:** AGPL-3.0 for the cloud (`web/`), so nobody can run a closed copy as a service. The desktop app, site and extension can be AGPL as well, which keeps it simple, or MIT if outside contributions matter more than protection.
- **Public repo:** one monorepo, as now.
  - Before it goes public, the git history has to be cleaned of personal recordings and frames (still waiting on that decision).
  - Keys must stay out of the history (`keys.env` is local; check it was never committed).
- **Public roadmap and changelog on the site:** Cap's GitHub stars and "build in public" are a large part of its growth.

## Decisions needed

1. Prices: $8 / $12 yearly, or different?
2. Free share links: any length, 10 GB in total?
3. License: AGPL for everything, or AGPL cloud + MIT apps?
4. Clean the git history, then create the public GitHub repo (name, organization)?
