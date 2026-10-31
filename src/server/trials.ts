// SERVER-ONLY. The Free Trial Vendor engine: eligibility, caps, approval,
// the one trial deal and its review, the sale gate, complaints, alerts and the
// end-of-trial rules. Money never passes through here: every sale is a direct
// charge on the vendor's own Stripe account (see stripe.ts / trial-stripe.ts).
//
// Vendors, deals and vouchers are queried directly (not via ./vendors) so that
// ./vendors can guard trial deals without a circular import.

import { getDb } from "./db";
import { CATEGORIES, CITIES, cityNameFromSlug } from "../lib/taxonomy";
import { validateDealRules } from "../lib/deal-rules";
import {
  TRIAL,
  REVIEW_TRIGGER_FIELDS,
  addDaysIso,
  addMonthsIso,
  daysUntil,
  type TrialEndReason,
  type TrialStatus,
} from "../lib/trial-rules";
import { sendMailInBackground } from "./mail";
import * as tmail from "./trial-mail";
import { localDay } from "./voucher-lifecycle";
import { randomBytes } from "node:crypto";

// ------------------------------------------------------------------ types

export type TrialRow = {
  id: number;
  vendor_id: number;
  business_id: number;
  city_slug: string;
  category_slug: string;
  status: TrialStatus;
  requested_at: string;
  approved_at: string | null;
  expires_at: string | null;
  live_deadline_at: string | null;
  first_live_at: string | null;
  ended_at: string | null;
  end_reason: TrialEndReason | null;
  decision_note: string | null;
};

type VendorBits = {
  id: number;
  email: string;
  business_name: string;
  is_active: number;
  tier: string;
  subscription_status: string;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: number;
};

const nowIso = () => new Date().toISOString();

function vendorBits(vendorId: number): VendorBits | null {
  return (
    getDb()
      .query<VendorBits, [number]>(
        `SELECT id, email, business_name, is_active, tier, subscription_status,
                stripe_connect_account_id, stripe_connect_charges_enabled
           FROM vendors WHERE id = ?`,
      )
      .get(vendorId) ?? null
  );
}

// ------------------------------------------------------------- audit/alerts

export function audit(
  trialId: number | null,
  actor: string,
  action: string,
  detail = "",
  dealId: number | null = null,
  at = nowIso(),
): void {
  getDb()
    .query("INSERT INTO trial_audit (trial_id, deal_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(trialId, dealId, actor, action, detail, at);
}

/** Records an admin alert once per key. Returns true only the first time. */
export function raiseAlert(trialId: number | null, kind: string, message: string, key: string): boolean {
  const res = getDb()
    .query("INSERT OR IGNORE INTO trial_alerts (trial_id, kind, message, alert_key, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(trialId, kind, message, key, nowIso());
  return res.changes > 0;
}

// ------------------------------------------------------------------ lookups

export function getTrial(id: number): TrialRow | null {
  return getDb().query<TrialRow, [number]>("SELECT * FROM free_trials WHERE id = ?").get(id) ?? null;
}

/** The vendor's current trial: the newest row. */
export function trialForVendor(vendorId: number): TrialRow | null {
  return (
    getDb()
      .query<TrialRow, [number]>("SELECT * FROM free_trials WHERE vendor_id = ? ORDER BY id DESC LIMIT 1")
      .get(vendorId) ?? null
  );
}

export function trialForDeal(dealId: number): TrialRow | null {
  return (
    getDb()
      .query<TrialRow, [number]>(
        "SELECT t.* FROM free_trials t JOIN deals d ON d.trial_id = t.id WHERE d.id = ?",
      )
      .get(dealId) ?? null
  );
}

export function trialDealId(trialId: number): number | null {
  return (
    getDb().query<{ id: number }, [number]>("SELECT id FROM deals WHERE trial_id = ? ORDER BY id LIMIT 1").get(trialId)
      ?.id ?? null
  );
}

export function cityCap(citySlug: string): number {
  const row = getDb()
    .query<{ vendor_cap: number }, [string]>("SELECT vendor_cap FROM trial_city_caps WHERE city_slug = ?")
    .get(citySlug);
  return Math.min(row?.vendor_cap ?? TRIAL.maxPerCity, TRIAL.maxPerCity);
}

/** Approved trial vendors in a city (active + ended + terminated; lapsed free their slot). */
export function cityUsage(citySlug: string): number {
  return (
    getDb()
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM free_trials WHERE city_slug = ? AND status IN ('active','ended','terminated')",
      )
      .get(citySlug)?.n ?? 0
  );
}

export function setCityCap(citySlug: string, cap: number): { ok: true } | { ok: false; message: string } {
  if (!CITIES.some((c) => c.slug === citySlug)) return { ok: false, message: "Unknown city." };
  if (!Number.isInteger(cap) || cap < 0 || cap > TRIAL.maxPerCity)
    return { ok: false, message: `The cap must be a whole number from 0 to ${TRIAL.maxPerCity}.` };
  getDb()
    .query(
      "INSERT INTO trial_city_caps (city_slug, vendor_cap) VALUES (?, ?) ON CONFLICT(city_slug) DO UPDATE SET vendor_cap = excluded.vendor_cap",
    )
    .run(citySlug, cap);
  audit(null, "admin", "city_cap_set", `${citySlug} = ${cap}`);
  return { ok: true };
}

function categoryTaken(citySlug: string, categorySlug: string): boolean {
  return !!getDb()
    .query<{ id: number }, [string, string]>(
      "SELECT id FROM free_trials WHERE city_slug = ? AND category_slug = ? AND status IN ('active','ended','terminated') LIMIT 1",
    )
    .get(citySlug, categorySlug);
}

// -------------------------------------------------------------- eligibility

export type ClaimedBusiness = { id: number; name: string; city_slug: string; category_slug: string };

export type Eligibility =
  | { ok: true; business: ClaimedBusiness }
  | { ok: false; reason: string; code: "no_claim" | "paid_plan" | "has_trial" | "category_taken" | "city_full" | "business_used" | "inactive" };

export function claimedBusinessForVendor(vendorId: number): ClaimedBusiness | null {
  return (
    getDb()
      .query<ClaimedBusiness, [number, number]>(
        `SELECT b.id, b.name, b.city_slug, b.category_slug
           FROM businesses b
           JOIN listing_claims c ON c.business_id = b.id AND c.vendor_id = ? AND c.status = 'approved'
          WHERE b.is_claimed = 1 AND b.claimed_by_vendor_id = ?
          ORDER BY c.decided_at DESC LIMIT 1`,
      )
      .get(vendorId, vendorId) ?? null
  );
}

export function checkEligibility(vendorId: number): Eligibility {
  const vendor = vendorBits(vendorId);
  if (!vendor || !vendor.is_active) return { ok: false, code: "inactive", reason: "This account is not active." };
  if (vendor.subscription_status === "active" || vendor.subscription_status === "trialing")
    return { ok: false, code: "paid_plan", reason: "You already have a paid plan, so you don't need the free trial." };

  const business = claimedBusinessForVendor(vendorId);
  if (!business)
    return {
      ok: false,
      code: "no_claim",
      reason: "Claim your business listing first. The trial belongs to one verified business listing.",
    };

  const own = getDb()
    .query<{ id: number }, [number, number]>(
      "SELECT id FROM free_trials WHERE (vendor_id = ? OR business_id = ?) AND status IN ('requested','active','ended','terminated') LIMIT 1",
    )
    .get(vendorId, business.id);
  if (own)
    return { ok: false, code: "has_trial", reason: "This business has already used its one free trial." };

  if (categoryTaken(business.city_slug, business.category_slug)) {
    return {
      ok: false,
      code: "category_taken",
      reason: "Another business in your category already holds the free trial in your city.",
    };
  }
  if (cityUsage(business.city_slug) >= cityCap(business.city_slug)) {
    return {
      ok: false,
      code: "city_full",
      reason: `The free trial is full in ${cityNameFromSlug(business.city_slug) ?? "your city"} right now.`,
    };
  }
  return { ok: true, business };
}

export type RequestResult = { ok: true; trial: TrialRow } | { ok: false; message: string };

export function requestTrial(vendorId: number): RequestResult {
  const elig = checkEligibility(vendorId);
  if (!elig.ok) return { ok: false, message: elig.reason };
  const db = getDb();
  try {
    const row = db
      .query<TrialRow, [number, number, string, string, string]>(
        `INSERT INTO free_trials (vendor_id, business_id, city_slug, category_slug, status, requested_at)
         VALUES (?, ?, ?, ?, 'requested', ?) RETURNING *`,
      )
      .get(vendorId, elig.business.id, elig.business.city_slug, elig.business.category_slug, nowIso());
    audit(row!.id, `vendor:${vendorId}`, "requested", elig.business.name);
    raiseAlert(row!.id, "trial_request", `New trial request: ${elig.business.name}`, `request-${row!.id}`);
    return { ok: true, trial: row! };
  } catch {
    return { ok: false, message: "This business already has a trial request." };
  }
}

// ----------------------------------------------------------------- decisions

export type DecisionResult = { ok: true; trial: TrialRow } | { ok: false; message: string };

export function approveTrial(trialId: number, note: string | null = null): DecisionResult {
  const db = getDb();
  const run = db.transaction((): DecisionResult => {
    const trial = getTrial(trialId);
    if (!trial) return { ok: false, message: "Trial not found." };
    if (trial.status !== "requested") return { ok: false, message: "That request was already decided." };
    const claim = claimedBusinessForVendor(trial.vendor_id);
    if (!claim || claim.id !== trial.business_id)
      return { ok: false, message: "The vendor no longer holds an approved claim on this listing." };
    if (categoryTaken(trial.city_slug, trial.category_slug))
      return { ok: false, message: "That category is already taken in this city." };
    if (cityUsage(trial.city_slug) >= cityCap(trial.city_slug))
      return { ok: false, message: `The ${cityNameFromSlug(trial.city_slug) ?? trial.city_slug} cap is reached.` };
    const at = nowIso();
    db.query(
      `UPDATE free_trials SET status = 'active', approved_at = ?, expires_at = ?, live_deadline_at = ?, decision_note = ?
        WHERE id = ? AND status = 'requested'`,
    ).run(at, addMonthsIso(at, TRIAL.durationMonths), addDaysIso(at, TRIAL.liveDeadlineDays), note, trialId);
    audit(trialId, "admin", "approved", note ?? "");
    return { ok: true, trial: getTrial(trialId)! };
  });
  const result = run();
  if (result.ok) {
    const v = vendorBits(result.trial.vendor_id);
    if (v)
      sendMailInBackground(
        tmail.trialApprovedEmail({
          to: v.email,
          businessName: v.business_name,
          liveDeadlineAt: result.trial.live_deadline_at!,
          expiresAt: result.trial.expires_at!,
        }),
      );
  }
  return result;
}

export function rejectTrial(trialId: number, note: string | null = null): DecisionResult {
  const trial = getTrial(trialId);
  if (!trial) return { ok: false, message: "Trial not found." };
  if (trial.status !== "requested") return { ok: false, message: "That request was already decided." };
  getDb()
    .query("UPDATE free_trials SET status = 'rejected', ended_at = ?, decision_note = ? WHERE id = ? AND status = 'requested'")
    .run(nowIso(), note, trialId);
  audit(trialId, "admin", "rejected", note ?? "");
  const v = vendorBits(trial.vendor_id);
  if (v) sendMailInBackground(tmail.trialRejectedEmail({ to: v.email, businessName: v.business_name, note }));
  return { ok: true, trial: getTrial(trialId)! };
}

// -------------------------------------------------------------- ending trials

function pauseTrialDeals(trialId: number, reason: string): void {
  getDb()
    .query("UPDATE deals SET status = 'paused', paused_reason = ? WHERE trial_id = ? AND status = 'published'")
    .run(reason, trialId);
}

/**
 * Ends an active trial. Sold vouchers stay redeemable (redemption never checks
 * the trial). A trial that never went live frees its slot (`lapsed`); an admin
 * termination is kept as `terminated`; everything else is `ended`.
 */
export function endTrial(trialId: number, reason: TrialEndReason, actor: string, note = ""): DecisionResult {
  const trial = getTrial(trialId);
  if (!trial) return { ok: false, message: "Trial not found." };
  if (trial.status !== "active") return { ok: false, message: "That trial isn't active." };
  const status: TrialStatus = reason === "lapsed" ? "lapsed" : reason === "admin_terminated" ? "terminated" : "ended";
  const at = nowIso();
  getDb()
    .query("UPDATE free_trials SET status = ?, ended_at = ?, end_reason = ? WHERE id = ? AND status = 'active'")
    .run(status, at, reason, trialId);
  pauseTrialDeals(trialId, reason);
  audit(trialId, actor, `ended:${reason}`, note, trialDealId(trialId));
  const v = vendorBits(trial.vendor_id);
  if (v) sendMailInBackground(tmail.trialEndedEmail({ to: v.email, businessName: v.business_name, reason }));
  return { ok: true, trial: getTrial(trialId)! };
}

export function terminateTrial(trialId: number, note: string): DecisionResult {
  return endTrial(trialId, "admin_terminated", "admin", note);
}

export function vendorEndTrial(vendorId: number): DecisionResult {
  const trial = trialForVendor(vendorId);
  if (!trial || trial.status !== "active") return { ok: false, message: "You don't have an active trial." };
  return endTrial(trial.id, "vendor_ended", `vendor:${vendorId}`);
}

/** Called when a vendor's paid subscription becomes active. */
export function endTrialsForUpgrade(vendorId: number): void {
  const trial = trialForVendor(vendorId);
  if (trial && trial.status === "active") endTrial(trial.id, "upgraded", `vendor:${vendorId}`);
  else if (trial && trial.status === "requested") {
    getDb().query("UPDATE free_trials SET status = 'rejected', ended_at = ?, decision_note = 'Upgraded to a paid plan' WHERE id = ?").run(nowIso(), trial.id);
    audit(trial.id, `vendor:${vendorId}`, "request_withdrawn", "upgraded");
  }
}

// ------------------------------------------------------------ the trial deal

export type TrialDealDraft = {
  title: string;
  description: string;
  highlights: string[];
  finePrint: string;
  priceCents: number;
  valueCents: number;
  voucherLimit: number;
  perCustomerLimit: number;
  redemptionStart: string | null;
  redemptionEnd: string | null;
  validDays: string[];
  blackoutDates: string[];
  redemptionInstructions: string;
  acceptTerms: boolean;
};

export type TrialDealResult =
  | { ok: true; id: number; slug: string; needsReview: boolean }
  | { ok: false; error: string; fields?: Record<string, string> };

const IMAGE_HINT: Record<string, string> = {
  "restaurants-cafes": "coffee",
  "bars-nightlife": "taproom",
  "health-medical-services": "dental",
  "home-repair-handyman-services": "handyman",
  "hair-nails-barber-shops": "barber",
  "local-retail-boutiques": "boutique",
  "auto-repair-detailing": "detailing",
  "professional-services": "office",
  "spas-massage-wellness": "wellness",
  "fitness-personal-training": "fitness",
  "grocery-markets": "market",
  "lodging-vacation-rentals": "cottage",
};

function slugFor(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return `${base || "deal"}-${randomBytes(3).toString("hex")}`;
}

export function validateTrialDeal(draft: TrialDealDraft, soldSoFar: number): Record<string, string> {
  const f: Record<string, string> = {};
  const title = draft.title.trim();
  if (title.length < 4) f.title = "Give the deal a title of at least 4 characters.";
  else if (title.length > 120) f.title = "Keep the title under 120 characters.";
  if (draft.description.trim().length < 20) f.description = "Describe the deal in at least 20 characters.";
  else if (draft.description.length > 2000) f.description = "Keep the description under 2,000 characters.";
  if (draft.highlights.length > 10) f.highlights = "List at most 10 highlights.";
  if (draft.highlights.some((h) => h.length > 200)) f.highlights = "Each highlight must be under 200 characters.";
  Object.assign(
    f,
    validateDealRules({
      priceCents: draft.priceCents,
      valueCents: draft.valueCents,
      minDiscountPct: 0,
      voucherLimit: draft.voucherLimit,
      perCustomerLimit: draft.perCustomerLimit,
      finePrint: draft.finePrint,
      redemptionInstructions: draft.redemptionInstructions,
      redemptionStart: draft.redemptionStart,
      redemptionEnd: draft.redemptionEnd,
      validDays: draft.validDays,
      blackoutDates: draft.blackoutDates,
      paymentLinkUrl: "",
      webhookUrl: "",
      skipPayment: true,
    }),
  );
  if (draft.priceCents > TRIAL.maxPriceCents)
    f.price = `Trial deals can charge at most $${TRIAL.maxPriceCents / 100}.`;
  if (draft.voucherLimit > TRIAL.maxVouchers)
    f.voucherLimit = `Trial deals can sell at most ${TRIAL.maxVouchers} vouchers.`;
  if (draft.voucherLimit < soldSoFar)
    f.voucherLimit = `${soldSoFar} already sold — the limit can't go below that.`;
  if (!draft.acceptTerms) f.terms = "Accept the voucher terms to continue.";
  return f;
}

type DealCompare = Record<(typeof REVIEW_TRIGGER_FIELDS)[number], string>;

function compareKey(d: {
  title: string; description: string; priceCents: number; valueCents: number; finePrint: string;
  redemptionInstructions: string; voucherLimit: number; redemptionStart: string | null; redemptionEnd: string | null; highlights: string[];
}): DealCompare {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    price_cents: String(d.priceCents),
    value_cents: String(d.valueCents),
    fine_print: d.finePrint.trim(),
    redemption_instructions: d.redemptionInstructions.trim(),
    voucher_limit: String(d.voucherLimit),
    redemption_start: d.redemptionStart ?? "",
    redemption_end: d.redemptionEnd ?? "",
    highlights: JSON.stringify(d.highlights),
  };
}

/** Creates the trial's one deal, or edits it. Key edits send it back to review. */
export function saveTrialDeal(vendorId: number, draft: TrialDealDraft): TrialDealResult {
  const trial = trialForVendor(vendorId);
  if (!trial || trial.status !== "active")
    return { ok: false, error: "no_trial", fields: { form: "You need an active free trial before creating a deal." } };
  const vendor = vendorBits(vendorId);
  if (!vendor || !vendor.is_active) return { ok: false, error: "inactive" };

  const db = getDb();
  const existing = db
    .query<Record<string, any>, [number]>("SELECT * FROM deals WHERE trial_id = ? ORDER BY id LIMIT 1")
    .get(trial.id);

  const fields = validateTrialDeal(draft, existing?.vouchers_sold ?? 0);
  if (Object.keys(fields).length > 0) return { ok: false, error: "invalid", fields };

  const cityName = cityNameFromSlug(trial.city_slug) ?? trial.city_slug;
  const at = nowIso();

  if (!existing) {
    const row = db
      .query<{ id: number; slug: string }, (string | number | null)[]>(
        `INSERT INTO deals
           (slug, title, vendor_name, vendor_city, category_slug, description, highlights, fine_print,
            price_cents, value_cents, voucher_limit, vouchers_sold, image_hint, is_sample,
            vendor_id, status, starts_at, ends_at, min_discount_pct, per_customer_limit,
            redemption_start, redemption_end, valid_days, blackout_dates, terms_accepted_at,
            redemption_instructions, trial_id, review_state, paused_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 'paused', ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'awaiting_review')
         RETURNING id, slug`,
      )
      .get(
        slugFor(draft.title), draft.title.trim(), vendor.business_name, cityName, trial.category_slug,
        draft.description.trim(), JSON.stringify(draft.highlights), draft.finePrint.trim(),
        draft.priceCents, draft.valueCents, draft.voucherLimit, IMAGE_HINT[trial.category_slug] ?? "default",
        vendorId, at, draft.perCustomerLimit, draft.redemptionStart, draft.redemptionEnd,
        JSON.stringify(draft.validDays), JSON.stringify(draft.blackoutDates), at,
        draft.redemptionInstructions.trim(), trial.id,
      );
    audit(trial.id, `vendor:${vendorId}`, "deal_submitted", draft.title.trim(), row!.id);
    raiseAlert(trial.id, "deal_review", `Deal waiting for review: ${draft.title.trim()}`, `review-${row!.id}-${at}`);
    return { ok: true, id: row!.id, slug: row!.slug, needsReview: true };
  }

  const before = compareKey({
    title: existing.title, description: existing.description, priceCents: existing.price_cents,
    valueCents: existing.value_cents, finePrint: existing.fine_print,
    redemptionInstructions: existing.redemption_instructions ?? "", voucherLimit: existing.voucher_limit,
    redemptionStart: existing.redemption_start, redemptionEnd: existing.redemption_end,
    highlights: JSON.parse(existing.highlights || "[]"),
  });
  const after = compareKey(draft);
  const changed = REVIEW_TRIGGER_FIELDS.filter((k) => before[k] !== after[k]);
  const needsReview = changed.length > 0;

  db.query(
    `UPDATE deals SET
       title = ?, description = ?, highlights = ?, fine_print = ?, price_cents = ?, value_cents = ?,
       voucher_limit = ?, per_customer_limit = ?, redemption_start = ?, redemption_end = ?,
       valid_days = ?, blackout_dates = ?, redemption_instructions = ?, terms_accepted_at = COALESCE(terms_accepted_at, ?),
       image_hint = ?
     WHERE id = ? AND vendor_id = ?`,
  ).run(
    draft.title.trim(), draft.description.trim(), JSON.stringify(draft.highlights), draft.finePrint.trim(),
    draft.priceCents, draft.valueCents, draft.voucherLimit, draft.perCustomerLimit,
    draft.redemptionStart, draft.redemptionEnd, JSON.stringify(draft.validDays), JSON.stringify(draft.blackoutDates),
    draft.redemptionInstructions.trim(), at, IMAGE_HINT[trial.category_slug] ?? "default", existing.id, vendorId,
  );

  if (needsReview) {
    db.query(
      "UPDATE deals SET status = 'paused', review_state = 'pending', review_note = NULL, paused_reason = 'changes_pending_review' WHERE id = ?",
    ).run(existing.id);
    audit(trial.id, `vendor:${vendorId}`, "deal_changed_for_review", changed.join(", "), existing.id);
    raiseAlert(trial.id, "deal_review", `Deal changes waiting for review: ${draft.title.trim()}`, `review-${existing.id}-${at}`);
  } else {
    audit(trial.id, `vendor:${vendorId}`, "deal_edited", "minor edit, no review needed", existing.id);
  }
  return { ok: true, id: existing.id, slug: existing.slug, needsReview };
}

/** Publishes an approved trial deal once the vendor's Stripe account can take payments. */
export function publishTrialDealIfReady(dealId: number): boolean {
  const db = getDb();
  const row = db
    .query<
      { id: number; trial_id: number; vendor_id: number; review_state: string; status: string; paused_reason: string | null; title: string; charges: number; tstatus: string; expires_at: string | null },
      [number]
    >(
      `SELECT d.id, d.trial_id, d.vendor_id, d.review_state, d.status, d.paused_reason, d.title,
              v.stripe_connect_charges_enabled AS charges, t.status AS tstatus, t.expires_at
         FROM deals d JOIN vendors v ON v.id = d.vendor_id JOIN free_trials t ON t.id = d.trial_id
        WHERE d.id = ?`,
    )
    .get(dealId);
  if (!row || row.review_state !== "approved" || row.tstatus !== "active") return false;
  if (row.expires_at && row.expires_at < nowIso()) return false;
  if (!row.charges) {
    if (row.paused_reason !== "awaiting_stripe")
      db.query("UPDATE deals SET paused_reason = 'awaiting_stripe' WHERE id = ?").run(dealId);
    return false;
  }
  if (row.status === "published") return true;
  // Only the "waiting" reasons auto-publish; complaints, vendor pauses and admin pauses stay paused.
  if (row.paused_reason && !["awaiting_stripe", "awaiting_review"].includes(row.paused_reason)) return false;
  db.query("UPDATE deals SET status = 'published', paused_reason = NULL WHERE id = ?").run(dealId);
  const at = nowIso();
  db.query("UPDATE free_trials SET first_live_at = COALESCE(first_live_at, ?) WHERE id = ?").run(at, row.trial_id);
  audit(row.trial_id, "system", "deal_live", row.title, dealId);
  return true;
}

export function reviewTrialDeal(
  dealId: number,
  decision: "approved" | "rejected",
  note: string | null,
): { ok: true } | { ok: false; message: string } {
  const db = getDb();
  const deal = db
    .query<{ id: number; trial_id: number | null; title: string; vendor_id: number; review_state: string }, [number]>(
      "SELECT id, trial_id, title, vendor_id, review_state FROM deals WHERE id = ?",
    )
    .get(dealId);
  if (!deal || deal.trial_id == null) return { ok: false, message: "That is not a trial deal." };
  if (deal.review_state !== "pending") return { ok: false, message: "That deal isn't waiting for review." };
  if (decision === "rejected" && !(note && note.trim()))
    return { ok: false, message: "Add a note telling the vendor what to change." };
  const at = nowIso();
  db.query("UPDATE deals SET review_state = ?, review_note = ?, reviewed_at = ?, paused_reason = ? WHERE id = ?").run(
    decision,
    note,
    at,
    decision === "approved" ? "awaiting_stripe" : "changes_requested",
    dealId,
  );
  audit(deal.trial_id, "admin", `deal_${decision}`, note ?? "", dealId);
  const live = decision === "approved" ? publishTrialDealIfReady(dealId) : false;
  const v = vendorBits(deal.vendor_id);
  if (v) {
    sendMailInBackground(
      decision === "approved"
        ? tmail.dealApprovedEmail({ to: v.email, dealTitle: deal.title, live })
        : tmail.dealChangesRequestedEmail({ to: v.email, dealTitle: deal.title, note }),
    );
  }
  return { ok: true };
}

/** Vendor pauses / resumes their own trial deal. Resuming never overrides complaints, review or ending. */
export function vendorSetTrialDealPaused(
  vendorId: number,
  paused: boolean,
): { ok: true } | { ok: false; message: string } {
  const trial = trialForVendor(vendorId);
  if (!trial || trial.status !== "active") return { ok: false, message: "You don't have an active trial." };
  const dealId = trialDealId(trial.id);
  if (dealId == null) return { ok: false, message: "Create your deal first." };
  const db = getDb();
  const deal = db
    .query<{ status: string; paused_reason: string | null; review_state: string }, [number]>(
      "SELECT status, paused_reason, review_state FROM deals WHERE id = ?",
    )
    .get(dealId)!;
  if (paused) {
    if (deal.status === "published") {
      db.query("UPDATE deals SET status = 'paused', paused_reason = 'vendor' WHERE id = ?").run(dealId);
      audit(trial.id, `vendor:${vendorId}`, "deal_paused", "", dealId);
    }
    return { ok: true };
  }
  if (deal.review_state !== "approved") return { ok: false, message: "The deal has to be approved before it can go live." };
  if (deal.paused_reason !== "vendor")
    return { ok: false, message: "This deal was paused by My Neighborhood or is waiting on a requirement, so it can't be resumed here." };
  db.query("UPDATE deals SET paused_reason = 'awaiting_stripe' WHERE id = ?").run(dealId);
  const live = publishTrialDealIfReady(dealId);
  if (live) audit(trial.id, `vendor:${vendorId}`, "deal_resumed", "", dealId);
  return live ? { ok: true } : { ok: false, message: "Connect your Stripe account first — the deal goes live as soon as it can take payments." };
}

/** Admin lifts a complaint/admin pause. */
export function adminResumeTrialDeal(dealId: number): { ok: true } | { ok: false; message: string } {
  const db = getDb();
  const d = db
    .query<{ trial_id: number | null; review_state: string; status: string }, [number]>(
      "SELECT trial_id, review_state, status FROM deals WHERE id = ?",
    )
    .get(dealId);
  if (!d || d.trial_id == null) return { ok: false, message: "That is not a trial deal." };
  if (d.review_state !== "approved") return { ok: false, message: "The deal isn't approved." };
  db.query("UPDATE deals SET paused_reason = 'awaiting_stripe' WHERE id = ?").run(dealId);
  const live = publishTrialDealIfReady(dealId);
  audit(d.trial_id, "admin", "deal_resumed", live ? "live" : "waiting on Stripe", dealId);
  return { ok: true };
}

export function adminPauseTrialDeal(dealId: number, reason: string): { ok: true } | { ok: false; message: string } {
  const d = getDb().query<{ trial_id: number | null }, [number]>("SELECT trial_id FROM deals WHERE id = ?").get(dealId);
  if (!d || d.trial_id == null) return { ok: false, message: "That is not a trial deal." };
  getDb().query("UPDATE deals SET status = 'paused', paused_reason = 'admin' WHERE id = ?").run(dealId);
  audit(d.trial_id, "admin", "deal_paused", reason, dealId);
  return { ok: true };
}

// ----------------------------------------------------------------- sale gate

export type SaleGate = { ok: true } | { ok: false; reason: string };

/** Sum of vouchers that count against the 100 cap: Stripe-verified plus live checkout holds. */
export function committedQuantity(dealId: number, now = Date.now()): { verified: number; held: number } {
  const db = getDb();
  const verified =
    db
      .query<{ n: number }, [number]>(
        "SELECT COALESCE(SUM(quantity), 0) AS n FROM vouchers WHERE deal_id = ? AND stripe_payment_intent IS NOT NULL",
      )
      .get(dealId)?.n ?? 0;
  const held =
    db
      .query<{ n: number }, [number, string]>(
        `SELECT COALESCE(SUM(quantity), 0) AS n FROM vouchers
          WHERE deal_id = ? AND status = 'pending_payment' AND stripe_payment_intent IS NULL AND checkout_expires_at > ?`,
      )
      .get(dealId, new Date(now).toISOString())?.n ?? 0;
  return { verified, held };
}

/** Vouchers (verified + held) created today on the vendor's local clock. */
export function todayQuantity(dealId: number, now = Date.now()): number {
  const today = localDay(now).isoDay;
  const rows = getDb()
    .query<{ quantity: number; created_at: string }, [number, string, string]>(
      `SELECT quantity, created_at FROM vouchers
        WHERE deal_id = ? AND created_at >= ?
          AND (stripe_payment_intent IS NOT NULL OR (status = 'pending_payment' AND checkout_expires_at > ?))`,
    )
    .all(dealId, new Date(now - 2 * 86_400_000).toISOString(), new Date(now).toISOString());
  return rows.filter((r) => localDay(new Date(r.created_at)).isoDay === today).reduce((a, r) => a + r.quantity, 0);
}

export function trialSaleGate(dealId: number, qty: number, now = Date.now()): SaleGate {
  const db = getDb();
  const d = db
    .query<
      { id: number; status: string; review_state: string; trial_id: number | null; vendor_id: number | null; price_cents: number; voucher_limit: number; vouchers_sold: number },
      [number]
    >("SELECT id, status, review_state, trial_id, vendor_id, price_cents, voucher_limit, vouchers_sold FROM deals WHERE id = ?")
    .get(dealId);
  if (!d || d.trial_id == null || d.vendor_id == null) return { ok: false, reason: "This deal isn't available." };
  const trial = getTrial(d.trial_id);
  if (!trial || trial.status !== "active") return { ok: false, reason: "This deal isn't available." };
  if (trial.expires_at && trial.expires_at <= new Date(now).toISOString()) return { ok: false, reason: "This deal isn't available." };
  if (d.status !== "published" || d.review_state !== "approved") return { ok: false, reason: "This deal isn't available." };
  const vendor = vendorBits(d.vendor_id);
  if (!vendor || !vendor.is_active || !vendor.stripe_connect_account_id || !vendor.stripe_connect_charges_enabled)
    return { ok: false, reason: "This business can't take payments right now." };
  if (d.price_cents > TRIAL.maxPriceCents) return { ok: false, reason: "This deal isn't available." };

  const { verified, held } = committedQuantity(dealId, now);
  if (verified + held + qty > TRIAL.maxVouchers)
    return { ok: false, reason: `Only ${Math.max(0, TRIAL.maxVouchers - verified - held)} vouchers are left for this deal right now.` };
  if (d.vouchers_sold + qty > d.voucher_limit) return { ok: false, reason: "This deal is sold out." };
  const today = todayQuantity(dealId, now);
  if (today + qty > TRIAL.maxPerDay) {
    raiseAlert(trial.id, "daily_limit", `Daily limit of ${TRIAL.maxPerDay} reached`, `daily-${trial.id}-${localDay(now).isoDay}`);
    return { ok: false, reason: `This deal sells at most ${TRIAL.maxPerDay} vouchers a day and today's are gone. Try again tomorrow.` };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ vouchers

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export type TrialVoucherInput = { slug: string; buyerId: number; quantity: number };
export type TrialVoucherResult =
  | { ok: true; code: string; deal: { id: number; title: string; vendor_name: string; price_cents: number }; vendorId: number; connectAccountId: string; amountCents: number }
  | { ok: false; message: string };

/** Reserves a voucher for a registered buyer. It becomes valid only when Stripe verifies the payment. */
export function createTrialVoucher(input: TrialVoucherInput): TrialVoucherResult {
  const qty = Math.floor(Number(input.quantity));
  if (!Number.isInteger(qty) || qty < 1 || qty > 5) return { ok: false, message: "Choose 1 to 5 vouchers." };
  const db = getDb();
  const run = db.transaction((): TrialVoucherResult => {
    const deal = db
      .query<{ id: number; title: string; vendor_name: string; price_cents: number; vendor_id: number; per_customer_limit: number; trial_id: number }, [string]>(
        "SELECT id, title, vendor_name, price_cents, vendor_id, per_customer_limit, trial_id FROM deals WHERE slug = ? AND trial_id IS NOT NULL",
      )
      .get(input.slug);
    if (!deal) return { ok: false, message: "This deal isn't available." };
    const gate = trialSaleGate(deal.id, qty);
    if (!gate.ok) return { ok: false, message: gate.reason };
    const buyer = db.query<{ name: string; email: string }, [number]>("SELECT name, email FROM buyers WHERE id = ?").get(input.buyerId);
    if (!buyer) return { ok: false, message: "Sign in to buy." };

    const perCustomer = deal.per_customer_limit || 1;
    const already =
      db
        .query<{ n: number }, [number, number, string]>(
          `SELECT COALESCE(SUM(quantity), 0) AS n FROM vouchers
            WHERE deal_id = ? AND buyer_id = ? AND status IN ('issued','redeemed','pending_payment')
              AND (stripe_payment_intent IS NOT NULL OR checkout_expires_at > ?)`,
        )
        .get(deal.id, input.buyerId, nowIso())?.n ?? 0;
    if (already + qty > perCustomer)
      return {
        ok: false,
        message: already >= perCustomer
          ? `This deal is limited to ${perCustomer} per customer, and you already have ${already}.`
          : `This deal is limited to ${perCustomer} per customer. You can still buy ${perCustomer - already}.`,
      };

    const vendor = vendorBits(deal.vendor_id)!;
    const createdAt = nowIso();
    const expires = new Date(Date.now() + TRIAL.checkoutHoldMinutes * 60_000).toISOString();
    const amount = deal.price_cents * qty;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      try {
        const row = db
          .query<{ id: number }, (string | number)[]>(
            `INSERT INTO vouchers
               (code, deal_id, buyer_name, buyer_email, quantity, amount_cents, status, created_at, order_ref, buyer_id, checkout_expires_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?) RETURNING id`,
          )
          .get(code, deal.id, buyer.name, buyer.email, qty, amount, createdAt, `T${code.replace("-", "")}`, input.buyerId, expires);
        db.query("UPDATE deals SET vouchers_sold = vouchers_sold + ? WHERE id = ?").run(qty, deal.id);
        db.query(
          `INSERT INTO voucher_events (voucher_id, event, actor, vendor_id, note, created_at)
           VALUES (?, 'pending_created', 'buyer', ?, ?, ?)`,
        ).run(row!.id, deal.vendor_id, "Buyer sent to Stripe Checkout on the vendor's own account.", createdAt);
        return {
          ok: true,
          code,
          deal: { id: deal.id, title: deal.title, vendor_name: deal.vendor_name, price_cents: deal.price_cents },
          vendorId: deal.vendor_id,
          connectAccountId: vendor.stripe_connect_account_id!,
          amountCents: amount,
        };
      } catch (e) {
        if (!String((e as Error).message).includes("UNIQUE")) throw e;
      }
    }
    return { ok: false, message: "Could not reserve a voucher. Try again." };
  });
  return run();
}

export function attachCheckoutSession(code: string, sessionId: string, expiresAtSeconds: number | undefined): void {
  getDb()
    .query("UPDATE vouchers SET stripe_session_id = ?, checkout_expires_at = COALESCE(?, checkout_expires_at) WHERE code = ?")
    .run(sessionId, expiresAtSeconds ? new Date(expiresAtSeconds * 1000).toISOString() : null, code);
}

/**
 * Releases an unpaid reservation (checkout abandoned/expired): the voucher is
 * marked `expired` while confirmed_at stays empty — checkRedemption refuses an
 * expired voucher that was never paid — and the sold counter is given back.
 */
export function releaseUnpaidTrialVoucher(code: string, why: string): boolean {
  const db = getDb();
  const run = db.transaction((): boolean => {
    const v = db
      .query<{ id: number; deal_id: number; quantity: number; vendor_id: number | null; trial_id: number | null }, [string]>(
        `SELECT v.id, v.deal_id, v.quantity, d.vendor_id, d.trial_id
           FROM vouchers v JOIN deals d ON d.id = v.deal_id
          WHERE v.code = ? AND v.status = 'pending_payment' AND v.stripe_payment_intent IS NULL AND d.trial_id IS NOT NULL`,
      )
      .get(code);
    if (!v) return false;
    const res = db.query("UPDATE vouchers SET status = 'expired' WHERE id = ? AND status = 'pending_payment'").run(v.id);
    if (res.changes === 0) return false;
    db.query("UPDATE deals SET vouchers_sold = MAX(0, vouchers_sold - ?) WHERE id = ?").run(v.quantity, v.deal_id);
    db.query(
      `INSERT INTO voucher_events (voucher_id, event, actor, vendor_id, note, created_at)
       VALUES (?, 'checkout_released', 'system', ?, ?, ?)`,
    ).run(v.id, v.vendor_id, `Checkout was not completed (${why}); no payment was taken.`, nowIso());
    return true;
  });
  return run();
}

// ----------------------------------------------------------------- complaints

export type ComplaintResult = { ok: true; paused: boolean } | { ok: false; message: string };

export function fileComplaint(buyerId: number, voucherCode: string, reason: string): ComplaintResult {
  const text = String(reason ?? "").trim();
  if (text.length < 10) return { ok: false, message: "Tell us what went wrong in at least 10 characters." };
  if (text.length > 1000) return { ok: false, message: "Keep it under 1,000 characters." };
  const db = getDb();
  const v = db
    .query<{ id: number; deal_id: number; trial_id: number | null; title: string; vendor_id: number | null }, [string, number]>(
      `SELECT v.id, v.deal_id, d.trial_id, d.title, d.vendor_id
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE v.code = ? AND v.buyer_id = ? AND v.stripe_payment_intent IS NOT NULL`,
    )
    .get(voucherCode.trim().toUpperCase(), buyerId);
  if (!v || v.trial_id == null) return { ok: false, message: "You can only report a deal you bought." };
  try {
    db.query("INSERT INTO trial_complaints (deal_id, buyer_id, voucher_id, reason, created_at) VALUES (?, ?, ?, ?, ?)").run(
      v.deal_id, buyerId, v.id, text, nowIso(),
    );
  } catch {
    return { ok: false, message: "You already reported this deal." };
  }
  audit(v.trial_id, `buyer:${buyerId}`, "complaint", text.slice(0, 200), v.deal_id);
  const count = db
    .query<{ n: number }, [number]>("SELECT COUNT(DISTINCT buyer_id) AS n FROM trial_complaints WHERE deal_id = ?")
    .get(v.deal_id)!.n;
  raiseAlert(v.trial_id, "complaint", `Complaint on "${v.title}" (${count} from different buyers)`, `complaint-${v.deal_id}-${count}`);
  let paused = false;
  if (count >= TRIAL.complaintThreshold) {
    const res = db
      .query("UPDATE deals SET status = 'paused', paused_reason = 'complaints' WHERE id = ? AND status = 'published'")
      .run(v.deal_id);
    paused = res.changes > 0;
    if (paused) {
      audit(v.trial_id, "system", "auto_paused_complaints", `${count} buyers`, v.deal_id);
      raiseAlert(v.trial_id, "complaint_pause", `Deal auto-paused after ${count} complaints: ${v.title}`, `complaint-pause-${v.deal_id}`);
      const vendor = v.vendor_id ? vendorBits(v.vendor_id) : null;
      if (vendor)
        sendMailInBackground(
          tmail.dealPausedEmail({ to: vendor.email, dealTitle: v.title, why: "Several buyers reported a problem, so it is paused while we look into it." }),
        );
    }
  }
  return { ok: true, paused };
}

// -------------------------------------------------------------------- sweeps

export function verifiedSold(dealId: number): number {
  return committedQuantity(dealId).verified;
}

/** Called after each Stripe-verified sale: progress emails, and ends the trial at 100. */
export function afterVerifiedSale(dealId: number): void {
  const trial = trialForDeal(dealId);
  if (!trial) return;
  const sold = verifiedSold(dealId);
  const vendor = vendorBits(trial.vendor_id);
  if (vendor && trial.status === "active") {
    const milestone: "first_sale" | "half" | "near_limit" | null =
      sold >= TRIAL.maxVouchers * 0.9 ? "near_limit" : sold >= TRIAL.maxVouchers / 2 ? "half" : sold >= 1 ? "first_sale" : null;
    if (milestone && raiseAlert(trial.id, `progress_${milestone}`, `${vendor.business_name}: ${milestone} (${sold} sold)`, `progress-${trial.id}-${milestone}`)) {
      sendMailInBackground(tmail.progressEmail({ to: vendor.email, businessName: vendor.business_name, milestone, sold }));
    }
  }
  if (sold >= TRIAL.maxVouchers && trial.status === "active") endTrial(trial.id, "sold_out", "system", `${sold} verified sales`);
}

export function sweepTrials(now = Date.now()): { lapsed: number; expired: number; alerts: number } {
  const db = getDb();
  const iso = new Date(now).toISOString();
  let lapsed = 0;
  let expired = 0;
  let alerts = 0;

  const active = db.query<TrialRow, []>("SELECT * FROM free_trials WHERE status = 'active'").all();
  for (const t of active) {
    const vendor = vendorBits(t.vendor_id);
    if (!t.first_live_at && t.live_deadline_at && t.live_deadline_at < iso) {
      endTrial(t.id, "lapsed", "system", "No live deal within the deadline");
      lapsed++;
      continue;
    }
    if (t.expires_at && t.expires_at < iso) {
      endTrial(t.id, "expired", "system", "Trial period reached");
      expired++;
      continue;
    }
    if (!t.first_live_at) {
      const left = daysUntil(t.live_deadline_at, now);
      if (left != null && left <= TRIAL.deadlineWarnDays && left > 0) {
        if (raiseAlert(t.id, "deadline", `${vendor?.business_name ?? "A vendor"}: ${left} days left to go live`, `deadline-${t.id}`)) {
          alerts++;
          if (vendor) sendMailInBackground(tmail.deadlineReminderEmail({ to: vendor.email, businessName: vendor.business_name, daysLeft: left, liveDeadlineAt: t.live_deadline_at! }));
        }
      }
    } else if (addDaysIso(t.first_live_at, TRIAL.noSalesAlertDays) < iso) {
      const dealId = trialDealId(t.id);
      if (dealId != null && verifiedSold(dealId) === 0) {
        if (raiseAlert(t.id, "no_sales", `${vendor?.business_name ?? "A vendor"}: 0 sales after ${TRIAL.noSalesAlertDays} days live`, `nosales-${t.id}`)) {
          alerts++;
          if (vendor) sendMailInBackground(tmail.progressEmail({ to: vendor.email, businessName: vendor.business_name, milestone: "no_sales", sold: 0 }));
        }
      }
    }
    const toEnd = daysUntil(t.expires_at, now);
    for (const mark of [30, 7]) {
      if (toEnd != null && toEnd <= mark && toEnd > 0 && vendor) {
        if (raiseAlert(t.id, "expiry", `${vendor.business_name}: trial ends in ${toEnd} days`, `expiry${mark}-${t.id}`)) {
          alerts++;
          sendMailInBackground(tmail.expiryReminderEmail({ to: vendor.email, businessName: vendor.business_name, daysLeft: toEnd, expiresAt: t.expires_at! }));
        }
      }
    }
  }
  return { lapsed, expired, alerts };
}

// -------------------------------------------------------------- read models

export type TrialSummary = {
  trial: TrialRow;
  businessName: string;
  dealId: number | null;
  verifiedSold: number;
  heldNow: number;
  soldToday: number;
  stripeConnected: boolean;
  chargesEnabled: boolean;
  daysToLive: number | null;
  daysToEnd: number | null;
};

export function trialSummary(vendorId: number): TrialSummary | null {
  const trial = trialForVendor(vendorId);
  if (!trial) return null;
  const vendor = vendorBits(vendorId)!;
  const dealId = trialDealId(trial.id);
  const q = dealId != null ? committedQuantity(dealId) : { verified: 0, held: 0 };
  return {
    trial,
    businessName: vendor.business_name,
    dealId,
    verifiedSold: q.verified,
    heldNow: q.held,
    soldToday: dealId != null ? todayQuantity(dealId) : 0,
    stripeConnected: !!vendor.stripe_connect_account_id,
    chargesEnabled: !!vendor.stripe_connect_charges_enabled,
    daysToLive: trial.first_live_at ? null : daysUntil(trial.live_deadline_at),
    daysToEnd: daysUntil(trial.expires_at),
  };
}

export function allCategorySlugs(): string[] {
  return CATEGORIES.map((c) => c.slug);
}
