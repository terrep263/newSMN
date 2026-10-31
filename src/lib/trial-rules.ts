// Free Trial Vendor rules — single source of truth, safe for client and server.
// These numbers are the owner's locked trial terms.

export const TRIAL = {
  /** Max trial vendors per city (a city may be capped lower, see trial_city_caps). */
  maxPerCity: 12,
  /** One trial vendor per category per city, ever (lapsed approvals excepted). */
  maxPerCategoryPerCity: 1,
  /** Days from admin approval to have a live (approved + published) deal. */
  liveDeadlineDays: 30,
  /** Only one active deal at a time. */
  maxActiveDeals: 1,
  /** Total vouchers a trial may sell (Stripe-verified sales only count toward the end). */
  maxVouchers: 100,
  /** Highest price a trial deal may charge, in cents. */
  maxPriceCents: 7500,
  /** Most vouchers that may be sold in one local day. */
  maxPerDay: 10,
  /** Trial length in months from admin approval. */
  durationMonths: 6,
  /** Complaints from different buyers that auto-pause a deal. */
  complaintThreshold: 3,
  /** Alert when a live deal has no sales after this many days. */
  noSalesAlertDays: 14,
  /** Alert when the live deadline is this many days away. */
  deadlineWarnDays: 7,
  /** Checkout hold on a reserved voucher, in minutes. */
  checkoutHoldMinutes: 30,
} as const;

export type TrialStatus = "requested" | "active" | "lapsed" | "ended" | "terminated" | "rejected";

export type TrialEndReason =
  | "upgraded"
  | "expired"
  | "sold_out"
  | "vendor_ended"
  | "admin_terminated"
  | "lapsed";

export const END_REASON_LABEL: Record<TrialEndReason, string> = {
  upgraded: "Upgraded to a paid plan",
  expired: "6 months reached",
  sold_out: "100 vouchers sold",
  vendor_ended: "Ended by the vendor",
  admin_terminated: "Ended by My Neighborhood",
  lapsed: "No live deal within 30 days of approval",
};

export const TRIAL_STATUS_LABEL: Record<TrialStatus, string> = {
  requested: "Awaiting approval",
  active: "Active",
  lapsed: "Lapsed",
  ended: "Ended",
  terminated: "Terminated",
  rejected: "Not approved",
};

export type ReviewState = "none" | "pending" | "approved" | "rejected";

/** True when a status still occupies the vendor's/business's one trial. */
export function trialHoldsSlot(status: TrialStatus): boolean {
  return status === "requested" || status === "active" || status === "ended" || status === "terminated";
}

/** Add whole calendar months to an ISO timestamp (clamps day-of-month). */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

/** Whole days from now until an ISO date (negative once past). */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

/** Deal fields that, when changed on a trial deal, send it back to admin review. */
export const REVIEW_TRIGGER_FIELDS = [
  "title",
  "description",
  "price_cents",
  "value_cents",
  "fine_print",
  "redemption_instructions",
  "voucher_limit",
  "redemption_start",
  "redemption_end",
  "highlights",
] as const;
