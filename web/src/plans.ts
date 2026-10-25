// What each plan includes: the one place to change pricing decisions. The cloud enforces these
// limits; the apps read them (GET /api/auth/me) to show what's available.

export type Plan = "free" | "pro" | "team";

export interface Entitlements {
  /** Share links on Umi Cloud. */
  cloudLinks: boolean;
  /** Longest video a share link can hold, in minutes (null: no limit). */
  maxVideoMinutes: number | null;
  /** Cloud storage, in GB (null: no limit). */
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
  // Storage is the only real cost (see docs/business-model.md), so Free limits storage, not length.
  free: { cloudLinks: true, maxVideoMinutes: null, storageGB: 10, umiBadge: true, insights: false, linkControls: true, workspaces: false, customDomain: false },
  pro: { cloudLinks: true, maxVideoMinutes: null, storageGB: 1000, umiBadge: false, insights: true, linkControls: true, workspaces: false, customDomain: true },
  team: { cloudLinks: true, maxVideoMinutes: null, storageGB: null, umiBadge: false, insights: true, linkControls: true, workspaces: true, customDomain: true },
};

export const isPlan = (p: unknown): p is Plan => p === "free" || p === "pro" || p === "team";
export const entitlements = (plan: string | null | undefined): Entitlements => PLANS[isPlan(plan) ? plan : "free"];
