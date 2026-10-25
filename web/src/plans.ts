// What each plan includes: the one place to change pricing decisions. The cloud enforces these
// limits; the apps read them (GET /api/auth/me) to show what's available.

export type Plan = "free" | "pro" | "team";

export interface Entitlements {
  /** Share links on Umi Cloud. */
  cloudLinks: boolean;
  /** Longest video a share link can hold, in minutes (null: no limit). */
  maxVideoMinutes: number | null;
  /** Share links kept at a time (null: no limit). */
  maxLinks: number | null;
  /** Days a link lasts before it's deleted (null: until you delete it). */
  linkDays: number | null;
  /** Cloud storage per account (each Team member has their own), in GB (null: no limit). */
  storageGB: number | null;
  /** "Made with Umi" on the share page. */
  umiBadge: boolean;
  /** Retention graph, countries, embeds (views and reactions are free). */
  insights: boolean;
  /** Password and expiry on links. */
  linkControls: boolean;
  /** Shared team workspaces. */
  workspaces: boolean;
  /** Share links on your own domain. */
  customDomain: boolean;
}

export const PLANS: Record<Plan, Entitlements> = {
  // Free: a taste of sharing (3 links of up to 5 minutes, kept a week); keeping them is Pro.
  // Worst case a free account holds ~3 × 5 min of 1080p (≈ 1.5 GB) for a week: cents.
  free: {
    cloudLinks: true,
    maxVideoMinutes: 5,
    maxLinks: 3,
    linkDays: 7,
    storageGB: 2,
    umiBadge: true,
    insights: false,
    linkControls: false,
    workspaces: false,
    customDomain: false,
  },
  // Paid storage is capped so even someone uploading hours every day costs less than they pay
  // (R2: $0.015 per GB-month, no egress): 200 GB is $3 a month at most.
  pro: {
    cloudLinks: true,
    maxVideoMinutes: 240,
    maxLinks: null,
    linkDays: null,
    storageGB: 200,
    umiBadge: false,
    insights: true,
    linkControls: true,
    workspaces: false,
    customDomain: true,
  },
  team: {
    cloudLinks: true,
    maxVideoMinutes: 240,
    maxLinks: null,
    linkDays: null,
    storageGB: 200,
    umiBadge: false,
    insights: true,
    linkControls: true,
    workspaces: true,
    customDomain: true,
  },
};

export const isPlan = (p: unknown): p is Plan => p === "free" || p === "pro" || p === "team";
export const entitlements = (plan: string | null | undefined): Entitlements => PLANS[isPlan(plan) ? plan : "free"];
