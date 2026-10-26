// SERVER-ONLY. Vendor accounts, their deals, sales figures and voucher
// redemption. Everything that decides *who* a vendor is gets its vendor_id from
// the session (see ./auth.ts) — never from the browser.
//
// Tier limits are enforced here, not in the UI: a Starter vendor cannot publish a
// 4th deal or sell the 301st voucher, Pro stops at 10 / 1,000, Enterprise is
// unlimited and a free listing cannot create deals at all.

import { randomBytes } from "node:crypto";

import { getDb } from "./db";
import {
  getDealById,
  getVoucherRaw,
  hydrate,
  vendorMonthlyVoucherCount,
  vendorVoucherPool,
  type Deal,
  type DealRow,
  type Voucher,
  type VoucherStatus,
} from "./repository";
import { CATEGORIES, CITIES, cityNameFromSlug } from "../lib/taxonomy";
import { DEFAULT_MIN_DISCOUNT_PCT, validateDealRules } from "../lib/deal-rules";
import { tierById } from "../lib/tiers";
import { newWebhookSecret } from "./webhooks";
import {
  checkRedemption,
  confirmVoucherPayment,
  getVoucherEvents,
  markVoucherRefunded,
  redeemVoucherCode,
  refundState,
  type RefundState,
  type VoucherEventRow,
} from "./voucher-lifecycle";

export type Vendor = {
  id: number;
  business_name: string;
  city_slug: string;
  category_slug: string;
  email: string;
  phone: string | null;
  website: string | null;
  tier: string;
  tier_selected_at: string | null;
  subscription_status: string;
  is_active: number;
  created_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** ISO timestamp of the end of the paid period, from Stripe. */
  current_period_end: string | null;
  subscription_updated_at: string | null;
};

export type VendorRow = Vendor & { password_hash: string };

const VENDOR_COLUMNS =
  "id, business_name, city_slug, category_slug, email, phone, website, tier, tier_selected_at, subscription_status, is_active, created_at, stripe_customer_id, stripe_subscription_id, current_period_end, subscription_updated_at";

// ---------------------------------------------------------------- accounts

export function getVendorById(id: number): Vendor | null {
  const row = getDb()
    .query<Vendor, [number]>(`SELECT ${VENDOR_COLUMNS} FROM vendors WHERE id = ?`)
    .get(id);
  return row ?? null;
}

export function getVendorRowByEmail(email: string): VendorRow | null {
  const row = getDb()
    .query<VendorRow, [string]>(
      `SELECT ${VENDOR_COLUMNS}, password_hash FROM vendors WHERE email = ?`,
    )
    .get(email.trim().toLowerCase());
  return row ?? null;
}

export function emailTaken(email: string): boolean {
  const row = getDb()
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM vendors WHERE email = ?")
    .get(email.trim().toLowerCase());
  return (row?.n ?? 0) > 0;
}

export type CreateVendorInput = {
  businessName: string;
  citySlug: string;
  categorySlug: string;
  email: string;
  phone: string | null;
  tier: string;
  passwordHash: string;
};

/**
 * Inserts the vendor with subscription_status 'awaiting_payment': the account
 * exists and can be listed, but no subscription is active until Stripe confirms
 * a paid Checkout Session (or the webhook says so). Nothing is charged here.
 */
export function insertVendor(input: CreateVendorInput): Vendor {
  const now = new Date().toISOString();
  const row = getDb()
    .query<Vendor, [string, string, string, string, string | null, string, string, string]>(
      `INSERT INTO vendors
         (business_name, city_slug, category_slug, email, password_hash, phone, website,
          tier, tier_selected_at, subscription_status, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'awaiting_payment', 1, ?)
       RETURNING ${VENDOR_COLUMNS}`,
    )
    .get(
      input.businessName,
      input.citySlug,
      input.categorySlug,
      input.email.trim().toLowerCase(),
      input.passwordHash,
      input.phone,
      input.tier,
      now,
      now,
    );
  return row as Vendor;
}

// ------------------------------------------------------------ subscriptions
/**
 * The only statuses that allow a vendor to run live deals. Everything else —
 * 'awaiting_payment' (signed up, has not paid), 'past_due', 'canceled',
 * 'incomplete' and the legacy 'unbilled' — keeps the account open but leaves
 * deal publishing blocked. Stripe is the source of truth; these rows are its
 * local mirror.
 */
export function subscriptionIsActive(vendor: {
  subscription_status: string | null;
}): boolean {
  return vendor.subscription_status === "active" || vendor.subscription_status === "trialing";
}

/** Human label for the dashboard, so all screens describe a status the same way. */
export function subscriptionLabel(status: string | null): string {
  switch (status) {
    case "active":
      return "Active";
    case "trialing":
      return "Trialing";
    case "past_due":
      return "Past due";
    case "canceled":
      return "Cancelled";
    case "incomplete":
      return "Payment incomplete";
    case "awaiting_payment":
      return "Awaiting payment";
    case "unbilled":
      return "Not subscribed";
    default:
      return status ? status.replace(/_/g, " ") : "Not subscribed";
  }
}

export type SubscriptionPatch = {
  status: string;
  tier?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  /** Unix seconds from Stripe, or null to clear. */
  currentPeriodEnd?: number | null;
};

function patchToColumns(patch: SubscriptionPatch): Record<string, string | null> {
  const cols: Record<string, string | null> = {
    subscription_status: patch.status,
    subscription_updated_at: new Date().toISOString(),
  };
  if (patch.tier !== undefined) cols.tier = patch.tier;
  if (patch.customerId !== undefined) cols.stripe_customer_id = patch.customerId;
  if (patch.subscriptionId !== undefined) cols.stripe_subscription_id = patch.subscriptionId;
  if (patch.currentPeriodEnd !== undefined) {
    cols.current_period_end = patch.currentPeriodEnd
      ? new Date(patch.currentPeriodEnd * 1000).toISOString()
      : null;
  }
  return cols;
}

/** Writes Stripe's state onto a vendor row. Only whitelisted columns are set. */
export function setSubscription(vendorId: number, patch: SubscriptionPatch): void {
  const cols = patchToColumns(patch);
  const assignments = Object.keys(cols)
    .map((k) => `${k} = ?`)
    .join(", ");
  getDb()
    .query(`UPDATE vendors SET ${assignments} WHERE id = ?`)
    .run(...(Object.values(cols) as string[]), vendorId);
}

/** Webhook path: find the vendor by Stripe customer id when no vendor_id rides along. */
export function vendorIdForStripeIdentifiers(
  customerId: string | null | undefined,
  subscriptionId: string | null | undefined,
): number | null {
  if (customerId) {
    const row = getDb()
      .query<{ id: number }, [string]>("SELECT id FROM vendors WHERE stripe_customer_id = ?")
      .get(customerId);
    if (row) return row.id;
  }
  if (subscriptionId) {
    const row = getDb()
      .query<{ id: number }, [string]>(
        "SELECT id FROM vendors WHERE stripe_subscription_id = ?",
      )
      .get(subscriptionId);
    if (row) return row.id;
  }
  return null;
}

// ---------------------------------------------------------------- sessions

export type SessionVendor = Vendor;

export function insertSession(token: string, vendorId: number, expiresAt: string): void {
  const db = getDb();
  db.query(
    "INSERT INTO sessions (token, vendor_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(token, vendorId, expiresAt, new Date().toISOString());
}

/** Returns the vendor behind a session token, or null when missing/expired/inactive. */
export function vendorForSession(token: string | undefined): SessionVendor | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .query<{ vendor_id: number; expires_at: string }, [string]>(
      "SELECT vendor_id, expires_at FROM sessions WHERE token = ?",
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.query("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  const vendor = getVendorById(row.vendor_id);
  if (!vendor || !vendor.is_active) return null;
  return vendor;
}

export function deleteSession(token: string): void {
  getDb().query("DELETE FROM sessions WHERE token = ?").run(token);
}

export function purgeExpiredSessions(): void {
  getDb()
    .query("DELETE FROM sessions WHERE expires_at <= ?")
    .run(new Date().toISOString());
}

// ------------------------------------------------------- login throttling

/** Failed logins within this window count toward the lockout. */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Failures allowed inside the window before the email is temporarily locked. */
export const LOGIN_MAX_FAILURES = 5;

/** Milliseconds left on this email's lockout (0 when it may try again). */
export function loginLockRemainingMs(email: string): number {
  const row = getDb()
    .query<{ fail_count: number; window_start: string }, [string]>(
      "SELECT fail_count, window_start FROM login_attempts WHERE email = ?",
    )
    .get(email.trim().toLowerCase());
  if (!row || row.fail_count < LOGIN_MAX_FAILURES) return 0;
  const elapsed = Date.now() - new Date(row.window_start).getTime();
  return Math.max(0, LOGIN_WINDOW_MS - elapsed);
}

export function recordLoginFailure(email: string): void {
  const db = getDb();
  const key = email.trim().toLowerCase();
  const now = new Date();
  const row = db
    .query<{ fail_count: number; window_start: string }, [string]>(
      "SELECT fail_count, window_start FROM login_attempts WHERE email = ?",
    )
    .get(key);
  if (!row || Date.now() - new Date(row.window_start).getTime() > LOGIN_WINDOW_MS) {
    db.query(
      `INSERT INTO login_attempts (email, fail_count, window_start, last_attempt) VALUES (?, 1, ?, ?)
       ON CONFLICT(email) DO UPDATE SET fail_count = 1, window_start = excluded.window_start, last_attempt = excluded.last_attempt`,
    ).run(key, now.toISOString(), now.toISOString());
    return;
  }
  db.query(
    "UPDATE login_attempts SET fail_count = fail_count + 1, last_attempt = ? WHERE email = ?",
  ).run(now.toISOString(), key);
}

export function clearLoginFailures(email: string): void {
  getDb().query("DELETE FROM login_attempts WHERE email = ?").run(email.trim().toLowerCase());
}

// ------------------------------------------------------------ vendor deals

export type VendorDeal = {
  id: number;
  slug: string;
  title: string;
  description: string;
  highlights: string[];
  fine_print: string;
  price_cents: number;
  value_cents: number;
  voucher_limit: number;
  vouchers_sold: number;
  remaining: number;
  category_slug: string;
  city_slug: string;
  vendor_city: string;
  status: "published" | "paused";
  image_hint: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string | null;
  // --- payment + webhook plumbing
  payment_link_url: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  // --- rules
  min_discount_pct: number;
  per_customer_limit: number;
  redemption_start: string | null;
  redemption_end: string | null;
  valid_days: string[];
  blackout_dates: string[];
  redemption_instructions: string | null;
  terms_accepted_at: string | null;
};

function toVendorDeal(row: ReturnType<typeof hydrate>): VendorDeal {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    highlights: row.highlights,
    fine_print: row.fine_print,
    price_cents: row.price_cents,
    value_cents: row.value_cents,
    voucher_limit: row.voucher_limit,
    vouchers_sold: row.vouchers_sold,
    remaining: Math.max(0, row.voucher_limit - row.vouchers_sold),
    category_slug: row.category_slug,
    city_slug: citySlugOf(row.vendor_city),
    vendor_city: row.vendor_city,
    status: row.status,
    image_hint: row.image_hint,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    created_at: null,
    payment_link_url: row.payment_link_url,
    webhook_url: row.webhook_url,
    webhook_secret: row.webhook_secret,
    min_discount_pct: row.min_discount_pct,
    per_customer_limit: row.per_customer_limit,
    redemption_start: row.redemption_start,
    redemption_end: row.redemption_end,
    valid_days: row.valid_days,
    blackout_dates: row.blackout_dates,
    redemption_instructions: row.redemption_instructions,
    terms_accepted_at: row.terms_accepted_at,
  };
}

function citySlugOf(cityName: string): string {
  return CITIES.find((c) => c.name === cityName)?.slug ?? cityName.toLowerCase().replace(/\s+/g, "-");
}

/** Every deal this vendor owns, newest first. Always scoped by vendor_id. */
export function listVendorDeals(vendorId: number): VendorDeal[] {
  const rows = getDb()
    .query<DealRow, [number]>(
      "SELECT * FROM deals WHERE vendor_id = ? ORDER BY id DESC",
    )
    .all(vendorId);
  return rows.map((r) => toVendorDeal(hydrate(r)));
}

export function getVendorDeal(vendorId: number, dealId: number): VendorDeal | null {
  const row = getDb()
    .query<DealRow, [number, number]>(
      "SELECT * FROM deals WHERE id = ? AND vendor_id = ?",
    )
    .get(dealId, vendorId);
  return row ? toVendorDeal(hydrate(row)) : null;
}

/** Deals the vendor currently has published — what the tier limit counts. */
export function countActiveDeals(vendorId: number): number {
  const row = getDb()
    .query<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM deals WHERE vendor_id = ? AND status = 'published'",
    )
    .get(vendorId);
  return row?.n ?? 0;
}

const IMAGE_HINT_BY_CATEGORY: Record<string, string> = {
  "restaurants-cafes": "coffee",
  "bars-nightlife": "taproom",
  "health-medical": "dental",
  "home-repair-handyman": "handyman",
  "hair-nails-barbers": "barber",
  "local-retail-boutiques": "boutique",
  "auto-repair-detailing": "detailing",
  "professional-services": "office",
  "spas-massage-wellness": "wellness",
  "fitness-personal-training": "fitness",
  "grocery-markets": "market",
  "lodging-vacation-rentals": "cottage",
};

function dealSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  const suffix = randomBytes(3).toString("hex"); // 6 chars, keeps slugs unique
  return `${base || "deal"}-${suffix}`;
}

export type DealDraft = {
  title: string;
  description: string;
  highlights: string[];
  finePrint: string;
  priceCents: number;
  valueCents: number;
  voucherLimit: number;
  categorySlug: string;
  citySlug: string;
  /** ISO strings or null */
  startsAt: string | null;
  endsAt: string | null;
  // --- voucher rules
  perCustomerLimit: number;
  redemptionStart: string | null;
  redemptionEnd: string | null;
  validDays: string[];
  blackoutDates: string[];
  redemptionInstructions: string;
  // --- how the vendor gets paid, and how we reach them
  paymentLinkUrl: string;
  webhookUrl: string;
  /** The vendor ticked the terms box on this save. */
  acceptTerms: boolean;
};

export type SaveDealResult =
  | { ok: true; id: number; slug: string; published: boolean }
  | { ok: false; error: string; fields?: Record<string, string> };

/**
 * The message a vendor sees when it tries to put a deal live without a paid
 * subscription. Worded to say what to do next, not just what failed.
 */
export function subscriptionPublishError(vendor: { subscription_status: string | null }): string {
  const status = vendor.subscription_status;
  if (status === "past_due") {
    return "Your subscription payment failed, so deals are paused. Update your card in Manage billing to put them live again.";
  }
  if (status === "canceled") {
    return "Your subscription is cancelled. Choose a plan to start a new one before publishing deals.";
  }
  return "Choose a plan to publish deals. Without an active subscription your business stays in the directory as a free listing, but voucher deals can't go live.";
}

function tierError(vendor: Vendor, failed: "deals" | "pool"): SaveDealResult {
  const tier = tierById(vendor.tier);
  if (vendor.tier === "free") {
    return {
      ok: false,
      error:
        "Your Free listing plan doesn't include deal creation. Choose Starter, Pro or Enterprise to publish voucher deals.",
    };
  }
  if (failed === "deals") {
    return {
      ok: false,
      error: `Your ${tier.name} plan allows ${tier.dealsLabel} at a time. Pause or end a live deal before creating another one.`,
    };
  }
  return {
    ok: false,
    error: `Your ${tier.name} plan includes ${tier.poolLabel}. That voucher limit is lower than this plan allows.`,
  };
}

/**
 * Validates a deal draft server-side. Returns a field -> message map.
 *
 * The voucher rules (discount floor, redemption window, valid days, blackouts,
 * fine print, payment link) come from lib/deal-rules so the form's live checks and
 * this server check can never drift apart. Tier limits are added here because they
 * need the vendor's plan.
 */
export function validateDealDraft(
  vendor: Vendor,
  draft: DealDraft,
  dealId?: number,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const title = draft.title.trim();
  if (title.length < 4) fields.title = "Give the deal a title of at least 4 characters.";
  else if (title.length > 120) fields.title = "Keep the title under 120 characters.";

  if (draft.description.trim().length < 20)
    fields.description = "Describe the deal in at least 20 characters.";
  else if (draft.description.length > 2000)
    fields.description = "Keep the description under 2,000 characters.";

  if (draft.highlights.length > 10) fields.highlights = "List at most 10 highlights.";
  if (draft.highlights.some((h) => h.length > 200))
    fields.highlights = "Each highlight must be under 200 characters.";

  if (!CATEGORIES.some((c) => c.slug === draft.categorySlug))
    fields.category = "Choose a category.";
  if (!CITIES.some((c) => c.slug === draft.citySlug)) fields.city = "Choose a city.";

  if (draft.startsAt && Number.isNaN(new Date(draft.startsAt).getTime()))
    fields.startsAt = "That start date isn't valid.";
  if (draft.endsAt && Number.isNaN(new Date(draft.endsAt).getTime()))
    fields.endsAt = "That end date isn't valid.";
  if (draft.startsAt && draft.endsAt && draft.endsAt <= draft.startsAt)
    fields.endsAt = "The end date must be after the start date.";

  // Every voucher rule, one message per rule.
  const rules = validateDealRules({
    priceCents: draft.priceCents,
    valueCents: draft.valueCents,
    minDiscountPct: DEFAULT_MIN_DISCOUNT_PCT,
    voucherLimit: draft.voucherLimit,
    perCustomerLimit: draft.perCustomerLimit,
    finePrint: draft.finePrint,
    redemptionInstructions: draft.redemptionInstructions,
    redemptionStart: draft.redemptionStart,
    redemptionEnd: draft.redemptionEnd,
    validDays: draft.validDays,
    blackoutDates: draft.blackoutDates,
    paymentLinkUrl: draft.paymentLinkUrl,
    webhookUrl: draft.webhookUrl,
  });
  Object.assign(fields, rules);

  // Tier limits: per-deal ceiling and the vendor's remaining monthly pool.
  const tier = tierById(vendor.tier);
  if (
    draft.voucherLimit > tier.maxVoucherLimitPerDeal &&
    Number.isFinite(tier.monthlyVoucherPool)
  ) {
    fields.voucherLimit = `Your ${tier.name} plan allows at most ${tier.maxVoucherLimitPerDeal.toLocaleString("en-US")} vouchers for one deal.`;
  } else if (Number.isFinite(tier.monthlyVoucherPool)) {
    // This deal's own vouchers this month don't count against its own new limit.
    const monthCount = vendorMonthlyVoucherCount(vendor.id);
    const ownCount = dealId ? dealMonthlyVoucherCount(vendor.id, dealId) : 0;
    const available = tier.monthlyVoucherPool - (monthCount - ownCount);
    if (draft.voucherLimit > available) {
      fields.voucherLimit =
        `Your ${tier.name} plan includes ${tier.poolLabel}, and ` +
        `${Math.max(0, available).toLocaleString("en-US")} of that is still available this month. ` +
        `Set the limit to ${Math.max(0, available).toLocaleString("en-US")} or less, or upgrade your plan.`;
    }
  }

  return fields;
}

/** Vouchers of one deal created in the current calendar month (UTC). */
function dealMonthlyVoucherCount(vendorId: number, dealId: number): number {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = getDb()
    .query<{ n: number }, [number, number, string]>(
      `SELECT COALESCE(SUM(v.quantity), 0) AS n
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.vendor_id = ? AND d.id = ? AND v.created_at >= ?`,
    )
    .get(vendorId, dealId, monthStart);
  return row?.n ?? 0;
}

/**
 * Why a deal cannot go live right now. Publishing needs an active plan, a payment
 * link (that is how the vendor gets paid) and an explicit acceptance of the voucher
 * terms. Returns null when nothing is blocking.
 */
export function publishBlockedReason(deal: VendorDeal): string | null {
  if (!deal.payment_link_url) {
    return "Add your payment link first — customers pay you there, so a deal can't publish without it.";
  }
  if (!deal.terms_accepted_at) {
    return "Accept the voucher terms at the bottom of the edit form before publishing. They cover who takes the money, expiry and refunds.";
  }
  return null;
}

export function createDealForVendor(vendor: Vendor, draft: DealDraft): SaveDealResult {
  const fields = validateDealDraft(vendor, draft);
  if (Object.keys(fields).length > 0) return { ok: false, error: "invalid", fields };

  const tier = tierById(vendor.tier);
  if (tier.maxActiveDeals < 1) return tierError(vendor, "deals");
  if (countActiveDeals(vendor.id) >= tier.maxActiveDeals) return tierError(vendor, "deals");

  const cityName = cityNameFromSlug(draft.citySlug) ?? draft.citySlug;
  const now = new Date().toISOString();
  const termsAcceptedAt = draft.acceptTerms ? now : null;
  const row = getDb()
    .query<{ id: number; slug: string }, (string | number | null)[]>(
      `INSERT INTO deals
         (slug, title, vendor_name, vendor_city, category_slug, description, highlights, fine_print,
          price_cents, value_cents, voucher_limit, vouchers_sold, image_hint, is_sample,
          vendor_id, status, starts_at, ends_at,
          payment_link_url, webhook_url, webhook_secret, min_discount_pct, per_customer_limit,
          redemption_start, redemption_end, valid_days, blackout_dates, terms_accepted_at,
          redemption_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 'published', ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, slug`,
    )
    .get(
      dealSlug(draft.title),
      draft.title.trim(),
      vendor.business_name,
      cityName,
      draft.categorySlug,
      draft.description.trim(),
      JSON.stringify(draft.highlights),
      draft.finePrint.trim(),
      draft.priceCents,
      draft.valueCents,
      draft.voucherLimit,
      IMAGE_HINT_BY_CATEGORY[draft.categorySlug] ?? "default",
      vendor.id,
      draft.startsAt ?? now,
      draft.endsAt,
      draft.paymentLinkUrl.trim(),
      draft.webhookUrl.trim() || null,
      newWebhookSecret(),
      DEFAULT_MIN_DISCOUNT_PCT,
      draft.perCustomerLimit,
      draft.redemptionStart,
      draft.redemptionEnd,
      JSON.stringify(draft.validDays),
      JSON.stringify(draft.blackoutDates),
      termsAcceptedAt,
      draft.redemptionInstructions.trim(),
    );

  // A new deal is inserted as 'published' (the status the tier limits count).
  // It only stays there when the plan is active and the vendor has accepted the
  // terms; otherwise it is parked as a draft ('paused') so the vendor keeps the
  // work and can publish once those are in place.
  let published = true;
  if (!subscriptionIsActive(vendor) || !draft.acceptTerms) {
    getDb().query("UPDATE deals SET status = 'paused' WHERE id = ?").run(row!.id);
    published = false;
  }
  return { ok: true, id: row!.id, slug: row!.slug, published };
}

export function updateDealForVendor(
  vendor: Vendor,
  dealId: number,
  draft: DealDraft,
): SaveDealResult {
  const existing = getVendorDeal(vendor.id, dealId);
  if (!existing) return { ok: false, error: "not_found" };

  const fields = validateDealDraft(vendor, draft, dealId);
  if (draft.voucherLimit < existing.vouchers_sold) {
    fields.voucherLimit = `${existing.vouchers_sold} voucher${existing.vouchers_sold === 1 ? " has" : "s have"} already been sold — the limit can't go below that.`;
  }
  if (Object.keys(fields).length > 0) return { ok: false, error: "invalid", fields };

  const cityName = cityNameFromSlug(draft.citySlug) ?? draft.citySlug;
  const termsAcceptedAt = draft.acceptTerms
    ? (existing.terms_accepted_at ?? new Date().toISOString())
    : null;

  getDb()
    .query(
      `UPDATE deals SET
         title = ?, vendor_city = ?, category_slug = ?, description = ?, highlights = ?,
         fine_print = ?, price_cents = ?, value_cents = ?, voucher_limit = ?, image_hint = ?,
         starts_at = ?, ends_at = ?, payment_link_url = ?, webhook_url = ?,
         webhook_secret = ?, per_customer_limit = ?, redemption_start = ?, redemption_end = ?,
         valid_days = ?, blackout_dates = ?, terms_accepted_at = ?, redemption_instructions = ?
       WHERE id = ? AND vendor_id = ?`,
    )
    .run(
      draft.title.trim(),
      cityName,
      draft.categorySlug,
      draft.description.trim(),
      JSON.stringify(draft.highlights),
      draft.finePrint.trim(),
      draft.priceCents,
      draft.valueCents,
      draft.voucherLimit,
      IMAGE_HINT_BY_CATEGORY[draft.categorySlug] ?? "default",
      draft.startsAt ?? existing.starts_at,
      draft.endsAt,
      draft.paymentLinkUrl.trim(),
      draft.webhookUrl.trim() || null,
      existing.webhook_secret ?? newWebhookSecret(),
      draft.perCustomerLimit,
      draft.redemptionStart,
      draft.redemptionEnd,
      JSON.stringify(draft.validDays),
      JSON.stringify(draft.blackoutDates),
      termsAcceptedAt,
      draft.redemptionInstructions.trim(),
      dealId,
      vendor.id,
    );
  return { ok: true, id: dealId, slug: existing.slug, published: existing.status === "published" };
}

export type SetStatusResult =
  | { ok: true; status: "published" | "paused" }
  | { ok: false; error: string };

/** Publishes or pauses one of the vendor's own deals, re-checking every gate. */
export function setDealStatus(
  vendor: Vendor,
  dealId: number,
  status: "published" | "paused",
): SetStatusResult {
  const deal = getVendorDeal(vendor.id, dealId);
  if (!deal) return { ok: false, error: "not_found" };

  if (status === "published" && deal.status !== "published") {
    // Gating: without an active subscription a vendor may keep drafts, but
    // nothing it owns may go live on the public marketplace. Enforced here on
    // the server so hiding a button in the UI is never the only defence.
    if (!subscriptionIsActive(vendor)) {
      return { ok: false, error: subscriptionPublishError(vendor) };
    }
    const blocked = publishBlockedReason(deal);
    if (blocked) return { ok: false, error: blocked };
    const tier = tierById(vendor.tier);
    if (tier.maxActiveDeals < 1) return tierError(vendor, "deals") as SetStatusResult;
    if (countActiveDeals(vendor.id) >= tier.maxActiveDeals) {
      return tierError(vendor, "deals") as SetStatusResult;
    }
  }

  getDb()
    .query("UPDATE deals SET status = ? WHERE id = ? AND vendor_id = ?")
    .run(status, dealId, vendor.id);
  return { ok: true, status };
}

// ---------------------------------------------------------------- sales

export type VoucherSale = {
  id: number;
  code: string;
  order_ref: string | null;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  amount_cents: number;
  status: VoucherStatus;
  created_at: string;
  redeemed_at: string | null;
  confirmed_at: string | null;
  confirmed_via: "webhook" | "manual" | "demo" | null;
  refunded_at: string | null;
  paid_value_only: number;
  deal_id: number;
  deal_title: string;
  deal_slug: string;
};

const SALE_COLUMNS = `v.id, v.code, v.order_ref, v.buyer_name, v.buyer_email, v.quantity,
  v.amount_cents, v.status, v.created_at, v.redeemed_at, v.confirmed_at, v.confirmed_via,
  v.refunded_at, v.paid_value_only, v.deal_id, d.title AS deal_title, d.slug AS deal_slug`;

export function vendorSalesSummary(vendorId: number) {
  const db = getDb();
  const totals = db
    .query<{ sold: number | null; amount: number | null; deals: number; published: number }, [number]>(
      `SELECT COALESCE(SUM(vouchers_sold), 0) AS sold,
              COALESCE(SUM(vouchers_sold * price_cents), 0) AS amount,
              COUNT(*) AS deals,
              COALESCE(SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END), 0) AS published
         FROM deals WHERE vendor_id = ?`,
    )
    .get(vendorId);
  return {
    deals: totals?.deals ?? 0,
    activeDeals: totals?.published ?? 0,
    totalVouchersSold: totals?.sold ?? 0,
    totalVoucherValueCents: totals?.amount ?? 0,
    vouchersThisMonth: vendorMonthlyVoucherCount(vendorId),
    poolLimit: vendorVoucherPool(vendorId),
  };
}

export function recentVendorVouchers(vendorId: number, limit = 8): VoucherSale[] {
  return getDb()
    .query<VoucherSale, [number, number]>(
      `SELECT ${SALE_COLUMNS}
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.vendor_id = ?
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT ?`,
    )
    .all(vendorId, limit);
}

export function dealSales(vendorId: number, dealId: number): VoucherSale[] {
  return getDb()
    .query<VoucherSale, [number, number]>(
      `SELECT ${SALE_COLUMNS}
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.vendor_id = ? AND d.id = ?
        ORDER BY v.created_at DESC, v.id DESC`,
    )
    .all(vendorId, dealId);
}

/** Vouchers waiting for the vendor to confirm the money arrived. */
export function pendingVouchersForVendor(vendorId: number): VoucherSale[] {
  return getDb()
    .query<VoucherSale, [number]>(
      `SELECT ${SALE_COLUMNS}
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.vendor_id = ? AND v.status = 'pending_payment'
        ORDER BY v.created_at DESC, v.id DESC`,
    )
    .all(vendorId);
}

export function pendingVouchersForDeal(vendorId: number, dealId: number): VoucherSale[] {
  return getDb()
    .query<VoucherSale, [number, number]>(
      `SELECT ${SALE_COLUMNS}
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.vendor_id = ? AND d.id = ? AND v.status = 'pending_payment'
        ORDER BY v.created_at DESC, v.id DESC`,
    )
    .all(vendorId, dealId);
}

// ------------------------------------------------- voucher state changes

export type VoucherActionResult =
  | { ok: true; message: string; code: string; status: VoucherStatus }
  | { ok: false; error: string; message: string };

/**
 * "The money arrived" — the manual equivalent of the vendor's webhook, for
 * vendors who never wire one up. Writes the same payment_confirmed event.
 */
export function confirmVoucherForVendor(vendorId: number, code: string): VoucherActionResult {
  const result = confirmVoucherPayment({ code, via: "manual", vendorId });
  if (!result.ok) return { ok: false, error: result.error, message: result.message };
  return {
    ok: true,
    code: result.voucher.code,
    status: result.voucher.status,
    message: "Payment confirmed. The voucher is now valid and can be redeemed.",
  };
}

/**
 * Marks a voucher refunded — within 24 hours of purchase and only while unused.
 * We never held the money, so this records the vendor's decision; the vendor
 * returns the money through their own payment provider.
 */
export function refundVoucherForVendor(
  vendorId: number,
  code: string,
  now: number = Date.now(),
): VoucherActionResult {
  const result = markVoucherRefunded(code, vendorId, now);
  if (!result.ok) return { ok: false, error: result.error, message: result.message };
  return {
    ok: true,
    code: result.voucher.code,
    status: result.voucher.status,
    message:
      "Marked refunded — the vendor returns the money through their own payment provider.",
  };
}

// ------------------------------------------------------------- redemption

export type RedeemableVoucher = {
  code: string;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  amount_cents: number;
  status: VoucherStatus;
  created_at: string;
  redeemed_at: string | null;
  confirmed_at: string | null;
  confirmed_via: string | null;
  paid_value_only: number;
  deal_id: number;
  deal_title: string;
  deal_slug: string;
  deal_city: string;
  deal_category: string;
  deal_price_cents: number;
  deal_ends_at: string | null;
  redemption_start: string | null;
  redemption_end: string | null;
  valid_days: string[];
  blackout_dates: string[];
};

export type RedeemLookup =
  | {
      ok: true;
      voucher: RedeemableVoucher;
      /** False when a rule stops it — `message` says which, in plain language. */
      canRedeem: boolean;
      /** True when the promo value lapsed but the paid value is still good. */
      paidValueOnly: boolean;
      message: string;
      refund: RefundState;
    }
  | {
      ok: false;
      error: "unknown" | "other_vendor" | "sample_deal";
      message: string;
    };

export function normalizeCode(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function toRedeemable(voucher: Voucher, deal: Deal): RedeemableVoucher {
  return {
    code: voucher.code,
    buyer_name: voucher.buyer_name,
    buyer_email: voucher.buyer_email,
    quantity: voucher.quantity,
    amount_cents: voucher.amount_cents,
    status: voucher.status,
    created_at: voucher.created_at,
    redeemed_at: voucher.redeemed_at,
    confirmed_at: voucher.confirmed_at,
    confirmed_via: voucher.confirmed_via,
    paid_value_only: voucher.paid_value_only,
    deal_id: deal.id,
    deal_title: deal.title,
    deal_slug: deal.slug,
    deal_city: deal.vendor_city,
    deal_category: deal.category_slug,
    deal_price_cents: deal.price_cents,
    deal_ends_at: deal.ends_at,
    redemption_start: deal.redemption_start,
    redemption_end: deal.redemption_end,
    valid_days: deal.valid_days,
    blackout_dates: deal.blackout_dates,
  };
}

type LoadedVoucher =
  | { ok: true; voucher: Voucher; deal: Deal }
  | { ok: false; error: "unknown" | "other_vendor" | "sample_deal"; message: string };

/** Loads a voucher + deal for a vendor, applying every ownership rule. */
function loadForVendor(vendorId: number, rawCode: string, now: number): LoadedVoucher {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "unknown", message: "Enter the voucher code first." };

  const voucher = getVoucherRaw(code);
  if (!voucher) {
    return {
      ok: false,
      error: "unknown",
      message: `No voucher found with the code ${code}. Check the code and try again.`,
    };
  }
  const deal = getDealById(voucher.deal_id);
  if (!deal) {
    return { ok: false, error: "unknown", message: "No voucher found with that code." };
  }
  if (deal.vendor_id == null) {
    return {
      ok: false,
      error: "sample_deal",
      message: "That voucher is for a sample deal, so it can't be redeemed.",
    };
  }
  if (deal.vendor_id !== vendorId) {
    return {
      ok: false,
      error: "other_vendor",
      message: "That voucher belongs to another business and can't be redeemed here.",
    };
  }
  void now;
  return { ok: true, voucher, deal };
}

/** Read-only: show the vendor what a code is, and whether it can be redeemed. */
export function lookupVoucherForVendor(
  vendorId: number,
  code: string,
  now: number = Date.now(),
): RedeemLookup {
  const loaded = loadForVendor(vendorId, code, now);
  if ("error" in loaded) return loaded;

  const check = checkRedemption(loaded.voucher, loaded.deal, now);
  return {
    ok: true,
    voucher: toRedeemable(loaded.voucher, loaded.deal),
    canRedeem: check.ok,
    paidValueOnly: check.ok && check.paidValueOnly,
    message: check.ok ? check.note : check.message,
    refund: refundState(loaded.voucher, now),
  };
}

export type RedeemResult =
  | {
      ok: true;
      redeemed: true;
      voucher: RedeemableVoucher;
      paidValueOnly: boolean;
      message: string;
    }
  | { ok: false; error: string; message: string };

/**
 * Marks a voucher redeemed. With `paidValueOnly` the vendor accepts a voucher
 * whose promotional value has lapsed at face value — the paid value never expires.
 */
export function redeemVoucherForVendor(
  vendorId: number,
  code: string,
  options: { paidValueOnly?: boolean; now?: number } = {},
): RedeemResult {
  const now = options.now ?? Date.now();
  const outcome = redeemVoucherCode(vendorId, code, { ...options, now });
  if (!outcome.ok) return { ok: false, error: outcome.error, message: outcome.message };

  const loaded = loadForVendor(vendorId, outcome.voucher.code, now);
  if ("error" in loaded) {
    return { ok: false, error: loaded.error, message: loaded.message };
  }
  return {
    ok: true,
    redeemed: true,
    paidValueOnly: outcome.paidValueOnly,
    voucher: toRedeemable(outcome.voucher, loaded.deal),
    message: outcome.paidValueOnly
      ? "Redeemed at paid value only — the promotional value had expired."
      : "Voucher redeemed.",
  };
}

/** The full audit trail for one of the vendor's own vouchers. */
export function voucherTrailForVendor(vendorId: number, code: string): VoucherEventRow[] | null {
  const voucher = getVoucherRaw(code);
  if (!voucher) return null;
  const deal = getDealById(voucher.deal_id);
  if (!deal || deal.vendor_id !== vendorId) return null;
  return getVoucherEvents(voucher.id);
}
