// Server functions for the vendor side. Every handler resolves the vendor from
// the session cookie on the server (see ./auth.ts) — the browser never sends a
// vendor_id and is never trusted for one. Repository/DB modules are imported
// dynamically so bun:sqlite and the password hashing never reach the client
// bundle.

import { createServerFn } from "@tanstack/react-start";

import type { VendorDeal } from "./vendors";
import type { RedeemLookup, RedeemResult, SaveDealResult, VoucherSale } from "./vendors";
import type { VoucherReport } from "./voucher-lifecycle";
import type { ClaimSummary } from "./listing-claim-functions";

export type { RedeemLookup, RedeemResult, SaveDealResult, VendorDeal, VoucherSale, VoucherReport };

/** Outcome of a voucher state change made from the dashboard. */
export type VoucherActionOutcome = {
  ok: boolean;
  message: string;
  code?: string;
  status?: string;
};

/** One row of the audit trail, as the vendor sees it. */
export type VoucherTrailEntry = {
  id: number;
  event: string;
  actor: string;
  note: string | null;
  created_at: string;
};

export type VendorMe = {
  id: number;
  businessName: string;
  email: string;
  phone: string | null;
  citySlug: string;
  categorySlug: string;
  tier: string;
  tierLabel: string;
  subscriptionStatus: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function toMe(vendor: {
  id: number;
  business_name: string;
  email: string;
  phone: string | null;
  city_slug: string;
  category_slug: string;
  tier: string;
  subscription_status: string;
}): VendorMe {
  return {
    id: vendor.id,
    businessName: vendor.business_name,
    email: vendor.email,
    phone: vendor.phone,
    citySlug: vendor.city_slug,
    categorySlug: vendor.category_slug,
    tier: vendor.tier,
    tierLabel: vendor.tier.charAt(0).toUpperCase() + vendor.tier.slice(1),
    subscriptionStatus: vendor.subscription_status,
  };
}

async function sessionVendor() {
  const auth = await import("./auth");
  return auth.currentVendor();
}

// -------------------------------------------------------------- session

export const fetchVendorMe = createServerFn({ method: "GET" }).handler(
  async (): Promise<VendorMe | null> => {
    const vendor = await sessionVendor();
    return vendor ? toMe(vendor) : null;
  },
);

// --------------------------------------------------------------- signup

export type SignupInput = {
  businessName: string;
  citySlug: string;
  categorySlug: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
  tier: string;
};

export type SignupResult =
  | { ok: true; vendor: VendorMe; checkoutUrl?: string | null }
  | { ok: false; fields: Record<string, string>; message: string };

export const vendorSignup = createServerFn({ method: "POST" })
  .validator((input: SignupInput) => input)
  .handler(async ({ data }): Promise<SignupResult> => {
    const [{ CATEGORIES, CITIES }, tiers] = await Promise.all([
      import("../lib/taxonomy"),
      import("../lib/tiers"),
    ]);
    const auth = await import("./auth");
    const store = await import("./vendors");

    const fields: Record<string, string> = {};

    const businessName = String(data.businessName ?? "").trim().replace(/\s+/g, " ");
    if (businessName.length < 2) fields.businessName = "Enter your business name.";
    else if (businessName.length > 120) fields.businessName = "Keep the name under 120 characters.";

    const citySlug = String(data.citySlug ?? "").trim();
    if (!CITIES.some((c) => c.slug === citySlug)) fields.citySlug = "Choose the city you operate in.";

    const categorySlug = String(data.categorySlug ?? "").trim();
    if (!CATEGORIES.some((c) => c.slug === categorySlug))
      fields.categorySlug = "Choose a category.";

    const email = String(data.email ?? "").trim().toLowerCase();
    if (!email) fields.email = "Enter an email address.";
    else if (email.length > 160 || !EMAIL_RE.test(email))
      fields.email = "That email address doesn't look right.";
    else if (store.emailTaken(email)) fields.email = "That email already has a vendor account.";

    const rawPhone = String(data.phone ?? "").trim();
    let phone: string | null = null;
    if (rawPhone) {
      if (rawPhone.length > 40) fields.phone = "Keep the phone number under 40 characters.";
      else if (!/^[0-9+()\-.\s]+$/.test(rawPhone)) fields.phone = "Use digits, spaces and ( ) + - only.";
      else phone = rawPhone;
    }

    const password = String(data.password ?? "");
    if (password.length < 8) fields.password = "Use at least 8 characters.";
    else if (password.length > 200) fields.password = "Keep the password under 200 characters.";
    if (password !== String(data.confirmPassword ?? ""))
      fields.confirmPassword = "The two passwords don't match.";

    const tier = String(data.tier ?? "");
    if (!tiers.isTierId(tier)) fields.tier = "Choose a plan.";

    if (Object.keys(fields).length > 0) {
      return { ok: false, fields, message: "Please fix the highlighted fields." };
    }

    const passwordHash = await auth.hashPassword(password);
    let vendor;
    try {
      vendor = store.insertVendor({
        businessName,
        citySlug,
        categorySlug,
        email,
        phone,
        tier,
        passwordHash,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE")) {
        return {
          ok: false,
          fields: { email: "That email already has a vendor account." },
          message: "That email already has a vendor account.",
        };
      }
      throw err;
    }

    auth.startSession(vendor);
    try { const mail = await import("./mail"); mail.sendMailInBackground(mail.welcomeEmail(vendor)); } catch (err) { console.error("[signup] welcome email skipped:", (err as Error).message); }

    // Straight into Stripe Checkout for the chosen tier. If billing is not
    // connected in this runtime, the account still exists (status
    // 'awaiting_payment') and the dashboard shows exactly what is missing —
    // nothing is silently marked as billed.
    let checkoutUrl: string | null = null;
    try {
      const stripe = await import("./stripe");
      if (stripe.stripeEnvStatus().configured) {
        const planTier = tiers.tierById(tier);
        if (planTier.stripePriceId) {
          const origin = signupOrigin();
          const session = await stripe.createSubscriptionCheckout({
            priceId: planTier.stripePriceId,
            vendorId: vendor.id,
            email: vendor.email,
            origin,
            tier: planTier.id,
          });
          checkoutUrl = session.url ?? null;
        }
      }
    } catch (err) {
      // A Stripe hiccup must not lose the account that was just created.
      console.error("[signup] could not start checkout:", (err as Error).message);
    }

    return { ok: true, vendor: toMe(vendor), checkoutUrl };
  });

/** Public origin for Stripe's return URLs after signup. */
function signupOrigin(): string {
  const explicit = (process.env.SITE_ORIGIN ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return "https://shopmyneighborhood.com";
}

// ---------------------------------------------------------------- login

export type LoginInput = { email: string; password: string };

export type LoginResult =
  | { ok: true; vendor: VendorMe }
  | { ok: false; error: "invalid" | "locked"; message: string; fields?: Record<string, string> };

export const vendorLogin = createServerFn({ method: "POST" })
  .validator((input: LoginInput) => input)
  .handler(async ({ data }): Promise<LoginResult> => {
    const auth = await import("./auth");
    const store = await import("./vendors");

    const email = String(data.email ?? "").trim().toLowerCase();
    const password = String(data.password ?? "");
    const fields: Record<string, string> = {};
    if (!email) fields.email = "Enter your email address.";
    if (!password) fields.password = "Enter your password.";
    if (Object.keys(fields).length > 0) {
      return { ok: false, error: "invalid", message: "Please fill in both fields.", fields };
    }

    const lockedMs = store.loginLockRemainingMs(email);
    if (lockedMs > 0) {
      const minutes = Math.max(1, Math.ceil(lockedMs / 60_000));
      return {
        ok: false,
        error: "locked",
        message: `Too many failed attempts on this email. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }

    const row = store.getVendorRowByEmail(email);
    // Verify against a dummy hash when the email is unknown so a missing account
    // and a wrong password take the same time to answer.
    const ok = row
      ? await auth.verifyPassword(password, row.password_hash)
      : await auth.verifyPassword(password, DUMMY_HASH);

    if (!row || !ok || !row.is_active) {
      store.recordLoginFailure(email);
      // Small, fixed delay: makes repeated guessing slow without implying an error.
      await new Promise((resolve) => setTimeout(resolve, 350));
      return {
        ok: false,
        error: "invalid",
        message: "That email and password combination doesn't match an account.",
      };
    }

    store.clearLoginFailures(email);
    auth.startSession(row);
    return { ok: true, vendor: toMe(row) };
  });

/** argon2id hash of a throwaway string, used to keep failed-login timing flat. */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$p/xfqbkHLtJr8BCbWUHJdC3UvOWkKmzknzmlgUkRlB4$MuVxo1BPIGIsTZUioh5tKLTXIzs3rc8f8ScZMdENZro";

export const vendorLogout = createServerFn({ method: "POST" }).handler(async () => {
  const auth = await import("./auth");
  auth.endSession();
  return { ok: true as const };
});

// ------------------------------------------------------------ dashboard

export type DashboardData = {
  me: VendorMe;
  plan: {
    id: string;
    name: string;
    priceLabel: string;
    dealsLabel: string;
    poolLabel: string;
    maxActiveDeals: number | null;
    monthlyVoucherPool: number | null;
  };
  usage: {
    activeDeals: number;
    totalDeals: number;
    vouchersThisMonth: number;
    poolLimit: number | null;
    totalVouchersSold: number;
    totalVoucherValueCents: number;
  };
  recent: VoucherSale[];
  /** Vouchers waiting for the vendor to confirm the money arrived. */
  pending: VoucherSale[];
  /** Sold / redeemed / refunded / expired / outstanding — vendor-reported. */
  report: VoucherReport;
  /** Latest directory ownership claim, if this vendor has submitted one. */
  claim: ClaimSummary | null;
};

export const fetchVendorDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardData | null> => {
    const vendor = await sessionVendor();
    if (!vendor) return null;
    const store = await import("./vendors");
    const lifecycle = await import("./voucher-lifecycle");
    const { tierById } = await import("../lib/tiers");

    const tier = tierById(vendor.tier);
    const summary = store.vendorSalesSummary(vendor.id);
    try {
      lifecycle.expireDueVouchers();
    } catch (err) {
      console.error("[dashboard] expiry sweep failed:", (err as Error).message);
    }
    const { getDb } = await import("./db");
    const claim = getDb().query<ClaimSummary, [number]>(
      `SELECT c.id, c.status, c.method, c.created_at, c.decided_at, c.decided_note,
              b.name AS business_name, b.slug AS business_slug
         FROM listing_claims c JOIN businesses b ON b.id = c.business_id
        WHERE c.vendor_id = ? ORDER BY c.created_at DESC LIMIT 1`,
    ).get(vendor.id) ?? null;
    return {
      me: toMe(vendor),
      plan: {
        id: tier.id,
        name: tier.name,
        priceLabel: tier.priceLabel,
        dealsLabel: tier.dealsLabel,
        poolLabel: tier.poolLabel,
        maxActiveDeals: Number.isFinite(tier.maxActiveDeals) ? tier.maxActiveDeals : null,
        monthlyVoucherPool: Number.isFinite(tier.monthlyVoucherPool)
          ? tier.monthlyVoucherPool
          : null,
      },
      usage: {
        activeDeals: summary.activeDeals,
        totalDeals: summary.deals,
        vouchersThisMonth: summary.vouchersThisMonth,
        poolLimit: Number.isFinite(summary.poolLimit) ? summary.poolLimit : null,
        totalVouchersSold: summary.totalVouchersSold,
        totalVoucherValueCents: summary.totalVoucherValueCents,
      },
      recent: store.recentVendorVouchers(vendor.id, 8),
      pending: store.pendingVouchersForVendor(vendor.id),
      report: lifecycle.vendorVoucherReport(vendor.id),
      claim,
    };
  },
);

// -------------------------------------------------------------- deals

export type VendorDealsData = {
  me: VendorMe;
  deals: VendorDeal[];
  activeDeals: number;
  maxActiveDeals: number | null;
  tierName: string;
  canCreateDeals: boolean;
  /** False when no subscription is active — deals can be drafted but not published. */
  subscriptionActive: boolean;
  subscriptionStatusLabel: string;
  /** Why publishing is blocked right now, or null when it isn't. */
  publishBlockedReason: string | null;
};

export const fetchVendorDeals = createServerFn({ method: "GET" }).handler(
  async (): Promise<VendorDealsData | null> => {
    const vendor = await sessionVendor();
    if (!vendor) return null;
    const store = await import("./vendors");
    const { tierById } = await import("../lib/tiers");
    const tier = tierById(vendor.tier);
    return {
      me: toMe(vendor),
      deals: store.listVendorDeals(vendor.id),
      activeDeals: store.countActiveDeals(vendor.id),
      maxActiveDeals: Number.isFinite(tier.maxActiveDeals) ? tier.maxActiveDeals : null,
      tierName: tier.name,
      canCreateDeals: tier.maxActiveDeals >= 1,
      subscriptionActive: store.subscriptionIsActive(vendor),
      subscriptionStatusLabel: store.subscriptionLabel(vendor.subscription_status),
      publishBlockedReason: store.subscriptionIsActive(vendor)
        ? null
        : store.subscriptionPublishError(vendor),
    };
  },
);

export type DealFormData = {
  me: VendorMe;
  deal: VendorDeal | null;
  voucherSold: number;
  tierName: string;
  voucherLimitCeiling: number | null;
};

export const fetchDealForm = createServerFn({ method: "GET" })
  .validator((input: { id?: number }) => input)
  .handler(async ({ data }): Promise<DealFormData | null> => {
    const vendor = await sessionVendor();
    if (!vendor) return null;
    const store = await import("./vendors");
    const { tierById } = await import("../lib/tiers");
    const tier = tierById(vendor.tier);
    const deal = data.id ? store.getVendorDeal(vendor.id, data.id) : null;
    return {
      me: toMe(vendor),
      deal,
      voucherSold: deal?.vouchers_sold ?? 0,
      tierName: tier.name,
      voucherLimitCeiling: Number.isFinite(tier.maxVoucherLimitPerDeal)
        ? tier.maxVoucherLimitPerDeal
        : null,
    };
  });

export type SaveDealInput = {
  id?: number;
  title: string;
  description: string;
  highlights: string;
  finePrint: string;
  price: string;
  value: string;
  voucherLimit: string;
  categorySlug: string;
  citySlug: string;
  startsAt: string;
  endsAt: string;
  /** 1–5; how many vouchers one customer may buy. */
  perCustomerLimit: string | number;
  redemptionStart: string;
  redemptionEnd: string;
  /** Weekday keys, e.g. ["mon","tue"]. Empty = every day. */
  validDays: string[];
  /** Newline- or comma-separated YYYY-MM-DD dates. */
  blackoutDates: string;
  redemptionInstructions: string;
  paymentLinkUrl: string;
  webhookUrl: string;
  /** The vendor ticked "I accept the voucher terms". */
  acceptTerms: boolean;
};

function toCents(raw: unknown): number {
  const text = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!text) return Number.NaN;
  const n = Number(text);
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100);
}

function toDateIso(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T12:00:00.000Z`)
    : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** "2026-12-25, 2026-12-26" or newline-separated -> ["2026-12-25","2026-12-26"]. */
function parseBlackoutDates(raw: unknown): string[] {
  const seen = new Set<string>();
  return String(raw ?? "")
    .split(/[\n,;]+/)
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });
}

export const saveVendorDeal = createServerFn({ method: "POST" })
  .validator((input: SaveDealInput) => input)
  .handler(async ({ data }): Promise<SaveDealResult | { ok: false; error: string }> => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false, error: "unauthenticated" };
    const store = await import("./vendors");

    const highlights = String(data.highlights ?? "")
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean)
      .slice(0, 10);

    const validDays = Array.isArray(data.validDays)
      ? data.validDays.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : [];

    const draft = {
      title: String(data.title ?? ""),
      description: String(data.description ?? ""),
      highlights,
      finePrint: String(data.finePrint ?? ""),
      priceCents: toCents(data.price),
      valueCents: toCents(data.value),
      voucherLimit: Number(String(data.voucherLimit ?? "").trim()),
      categorySlug: String(data.categorySlug ?? ""),
      citySlug: String(data.citySlug ?? ""),
      startsAt: toDateIso(data.startsAt),
      endsAt: toDateIso(data.endsAt),
      perCustomerLimit: Number(String(data.perCustomerLimit ?? "1").trim()),
      redemptionStart: toDateIso(data.redemptionStart),
      redemptionEnd: toDateIso(data.redemptionEnd),
      validDays,
      blackoutDates: parseBlackoutDates(data.blackoutDates),
      redemptionInstructions: String(data.redemptionInstructions ?? ""),
      paymentLinkUrl: String(data.paymentLinkUrl ?? "").trim(),
      webhookUrl: String(data.webhookUrl ?? "").trim(),
      acceptTerms: Boolean(data.acceptTerms),
    };

    if (data.id) return store.updateDealForVendor(vendor, Number(data.id), draft);
    return store.createDealForVendor(vendor, draft);
  });

export const setVendorDealStatus = createServerFn({ method: "POST" })
  .validator((input: { id: number; status: "published" | "paused" }) => input)
  .handler(async ({ data }) => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false as const, error: "unauthenticated" };
    const store = await import("./vendors");
    return store.setDealStatus(vendor, Number(data.id), data.status);
  });

export type DealSalesData = {
  me: VendorMe;
  deal: VendorDeal;
  vouchers: VoucherSale[];
  /** Vouchers still waiting for the vendor to confirm the money arrived. */
  pending: VoucherSale[];
  /** Sold / redeemed / refunded / expired / outstanding for this deal. */
  report: VoucherReport;
  /** Audit trail per voucher code. */
  trails: Record<string, VoucherTrailEntry[]>;
  /** Why this deal can't go live right now, or null. */
  publishBlockedReason: string | null;
};

export const fetchDealSales = createServerFn({ method: "GET" })
  .validator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<DealSalesData | null | "not_found"> => {
    const vendor = await sessionVendor();
    if (!vendor) return null;
    const store = await import("./vendors");
    const lifecycle = await import("./voucher-lifecycle");
    const deal = store.getVendorDeal(vendor.id, Number(data.id));
    if (!deal) return "not_found";
    try {
      lifecycle.expireDueVouchers();
    } catch (err) {
      console.error("[deal] expiry sweep failed:", (err as Error).message);
    }
    const vouchers = store.dealSales(vendor.id, deal.id);
    const trails: Record<string, VoucherTrailEntry[]> = {};
    for (const v of vouchers) {
      trails[v.code] = store.voucherTrailForVendor(vendor.id, v.code) ?? [];
    }
    return {
      me: toMe(vendor),
      deal,
      vouchers,
      pending: vouchers.filter((v) => v.status === "pending_payment"),
      report: lifecycle.dealVoucherReport(vendor.id, deal.id),
      trails,
      publishBlockedReason: store.publishBlockedReason(deal),
    };
  });

// ------------------------------------------------- voucher state changes

export const confirmVoucherPaymentManually = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }): Promise<VoucherActionOutcome> => {
    const vendor = await sessionVendor();
    if (!vendor)
      return { ok: false, message: "Your session expired — please log in again." };
    const store = await import("./vendors");
    return store.confirmVoucherForVendor(vendor.id, String(data.code ?? ""));
  });

export const refundVoucherManually = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }): Promise<VoucherActionOutcome> => {
    const vendor = await sessionVendor();
    if (!vendor)
      return { ok: false, message: "Your session expired — please log in again." };
    const store = await import("./vendors");
    return store.refundVoucherForVendor(vendor.id, String(data.code ?? ""));
  });

// ------------------------------------------------------------- redeem

export const lookupVoucher = createServerFn({ method: "POST" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }): Promise<RedeemLookup | { ok: false; error: "unauthenticated"; message: string }> => {
    const vendor = await sessionVendor();
    if (!vendor)
      return { ok: false, error: "unauthenticated", message: "Please log in again." };
    const store = await import("./vendors");
    return store.lookupVoucherForVendor(vendor.id, String(data.code ?? ""));
  });

export const redeemVoucher = createServerFn({ method: "POST" })
  .validator((input: { code: string; paidValueOnly?: boolean }) => input)
  .handler(async ({ data }): Promise<RedeemResult | { ok: false; error: "unauthenticated"; message: string }> => {
    const vendor = await sessionVendor();
    if (!vendor)
      return { ok: false, error: "unauthenticated", message: "Please log in again." };
    const store = await import("./vendors");
    return store.redeemVoucherForVendor(vendor.id, String(data.code ?? ""), {
      paidValueOnly: Boolean(data.paidValueOnly),
    });
  });
