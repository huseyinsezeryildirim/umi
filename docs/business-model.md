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

## What it costs Umi to serve someone

- **Storage:** Cloudflare R2 costs $0.015 per GB per month. Viewing (egress) is free.
  - A 3-minute 1080p video is about 60 MB, so 100 videos cost about $0.09 per month.
- **Processing:** videos are rendered on the user's computer and uploaded as finished MP4. There's no server transcoding, which is the expensive part for others.
- **AI:** captions, filler-word cutting, background blur and summaries run on the user's computer, so they cost Umi nothing.
- **Fixed:** Workers Paid is $5/month. Email through Resend is free up to 3,000 a month.

So a free user with share links costs cents a month. The real risk is abuse (hosting large or
pirated files), which length and storage limits handle.

## Proposal

**Everything on the computer is free, for everyone, including work use.** That's the line Loom
and Cap don't cross.

| | **Free** | **Pro** — $8/month yearly ($10 monthly) | **Team** — $12/user/month yearly ($15 monthly) |
|---|---|---|---|
| Record (app and browser), any length, 4K | ✓ | ✓ | ✓ |
| Full editor, zooms, captions, cut the ums, camera blur | ✓ | ✓ | ✓ |
| Export MP4/GIF, your own storage, self-hosted cloud | ✓ | ✓ | ✓ |
| Commercial use | ✓ | ✓ | ✓ |
| Share links on Umi Cloud | Unlimited links, up to **10 min** each, **10 GB** | No length limit, 1 TB | No limits |
| Views, reactions, comments, password, expiry | ✓ | ✓ | ✓ |
| "Made with Umi" on the share page | shown | removed | removed |
| Viewer insights (retention, countries, embeds) | | ✓ | ✓ |
| Your own domain for links, your logo | | ✓ | ✓ |
| Shared workspaces, admin, SSO later | | | ✓ |

Why these numbers:
- **Free beats both:** Loom gives 25 videos of 5 minutes at 720p. Cap's free tier is personal use only, with 5-minute links. Umi gives unlimited links of 10 minutes, and unlimited local recording for any use.
- **Pro is the cheapest paid plan:** it undercuts Cap Pro ($12) and Loom ($18). Most people never need more than Free, and that's fine: the free plan is the marketing.
- **Team is where the money is,** as with Loom. Companies pay per seat for shared libraries and admin.
- **Self-hosting stays free.** Later, enterprises can pay for support and an SLA (a contract, not a feature lock).

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
2. Free share-link limits: 10 min and 10 GB?
3. License: AGPL for everything, or AGPL cloud + MIT apps?
4. Clean the git history, then create the public GitHub repo (name, organization)?
