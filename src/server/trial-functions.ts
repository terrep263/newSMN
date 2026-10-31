// Server functions for the free-trial vendor flow and buyer accounts. Identity
// always comes from the session cookie on the server; the browser never sends a
// vendor_id or buyer_id. Server-only modules are imported dynamically so
// bun:sqlite, password hashing and the Stripe key never reach the client bundle.

import { createServerFn } from "@tanstack/react-start";

import type { TrialStatus, TrialEndReason, ReviewState } from "../lib/trial-rules";

// ---------------------------------------------------------------- shared types

export type BuyerMe = { id: number; name: string; email: string };
export type BuyerVoucherView = {
  code: string;
  dealTitle: string;
  dealSlug: string;
  vendorName: string;
  quantity: number;
  amountCents: number;
  status: string;
  createdAt: string;
  confirmed: boolean;
  complained: boolean;
  isTrial: boolean;
};
export type ActionOutcome = { ok: boolean; message: string; fields?: Record<string, string> };

export type TrialDealView = {
  id: number;
  slug: string;
  title: string;
  description: string;
  highlights: string;
  finePrint: string;
  price: string;
  value: string;
  voucherLimit: number;
  perCustomerLimit: number;
  redemptionStart: string;
  redemptionEnd: string;
  validDays: string[];
  blackoutDates: string;
  redemptionInstructions: string;
  status: "published" | "paused";
  reviewState: ReviewState;
  reviewNote: string | null;
  pausedReason: string | null;
  publicUrl: string;
};

export type TrialState = {
  vendorId: number;
  businessName: string;
  stripeConfigured: boolean;
  eligibility: { ok: true; businessName: string } | { ok: false; reason: string; code: string };
  trial: null | {
    id: number;
    status: TrialStatus;
    endReason: TrialEndReason | null;
    requestedAt: string;
    approvedAt: string | null;
    expiresAt: string | null;
    liveDeadlineAt: string | null;
    firstLiveAt: string | null;
    endedAt: string | null;
    decisionNote: string | null;
    verifiedSold: number;
    heldNow: number;
    soldToday: number;
    daysToLive: number | null;
    daysToEnd: number | null;
    stripeConnected: boolean;
    chargesEnabled: boolean;
  };
  deal: TrialDealView | null;
  shareKit: null | { url: string; headline: string; short: string; long: string };
  limits: { maxPriceCents: number; maxVouchers: number; maxPerDay: number; liveDeadlineDays: number };
  /** Other trial vendors in the same city (cross-vendor discovery). */
  neighbors: { name: string; dealTitle: string; slug: string }[];
};

async function origin(): Promise<string> {
  const explicit = (process.env.SITE_ORIGIN ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const { getRequestHost, getRequestProtocol } = await import("@tanstack/react-start/server");
    const proto = getRequestProtocol() === "http" ? "http" : "https";
    const host = getRequestHost();
    if (host && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return `${proto}://${host}`;
  } catch {
    /* no request context */
  }
  return "https://shopmyneighborhood.com";
}

async function sessionVendor() {
  const auth = await import("./auth");
  return auth.currentVendor();
}

async function sessionBuyer() {
  const buyers = await import("./buyers");
  return buyers.currentBuyer();
}

// ------------------------------------------------------------------- buyers

export const fetchBuyerMe = createServerFn({ method: "GET" }).handler(async (): Promise<BuyerMe | null> => {
  const b = await sessionBuyer();
  return b ? { id: b.id, name: b.name, email: b.email } : null;
});

export const buyerRegister = createServerFn({ method: "POST" })
  .validator((input: { name: string; email: string; password: string }) => input)
  .handler(async ({ data }): Promise<ActionOutcome> => {
    const buyers = await import("./buyers");
    const r = await buyers.registerBuyer({
      name: String(data.name ?? ""),
      email: String(data.email ?? ""),
      password: String(data.password ?? ""),
    });
    if (!r.ok) return { ok: false, message: r.message, fields: r.fields };
    buyers.startBuyerSession(r.buyer);
    return { ok: true, message: "Account created." };
  });

export const buyerLogin = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(async ({ data }): Promise<ActionOutcome> => {
    const buyers = await import("./buyers");
    const r = await buyers.loginBuyer({ email: String(data.email ?? ""), password: String(data.password ?? "") });
    if (!r.ok) return { ok: false, message: r.message };
    buyers.startBuyerSession(r.buyer);
    return { ok: true, message: "Signed in." };
  });

export const buyerLogout = createServerFn({ method: "POST" }).handler(async (): Promise<ActionOutcome> => {
  const buyers = await import("./buyers");
  buyers.endBuyerSession();
  return { ok: true, message: "Signed out." };
});

export const fetchMyVouchers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ buyer: BuyerMe; vouchers: BuyerVoucherView[] } | null> => {
    const buyers = await import("./buyers");
    const b = buyers.currentBuyer();
    if (!b) return null;
    // Settle any checkout the buyer left mid-way before listing.
    try {
      const ts = await import("./trial-stripe");
      const { getDb } = await import("./db");
      const pending = getDb()
        .query<{ code: string }, [number]>(
          "SELECT code FROM vouchers WHERE buyer_id = ? AND status = 'pending_payment' AND stripe_payment_intent IS NULL",
        )
        .all(b.id);
      for (const p of pending) await ts.reconcileTrialVoucher(p.code);
    } catch (e) {
      console.error("[buyer] reconcile failed:", (e as Error).message);
    }
    return {
      buyer: { id: b.id, name: b.name, email: b.email },
      vouchers: buyers.vouchersForBuyer(b.id),
    };
  },
);

export const beginTrialCheckout = createServerFn({ method: "POST" })
  .validator((input: { slug: string; quantity: number }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; message: string; url?: string; needsLogin?: boolean }> => {
    const buyer = await sessionBuyer();
    if (!buyer) return { ok: false, needsLogin: true, message: "Sign in or create an account to buy." };
    const ts = await import("./trial-stripe");
    const r = await ts.startTrialCheckout({
      buyerId: buyer.id,
      slug: String(data.slug ?? ""),
      quantity: Number(data.quantity),
      origin: await origin(),
    });
    return r.ok ? { ok: true, message: "Redirecting to checkout…", url: r.url } : { ok: false, message: r.message };
  });

export const reportDeal = createServerFn({ method: "POST" })
  .validator((input: { code: string; reason: string }) => input)
  .handler(async ({ data }): Promise<ActionOutcome> => {
    const buyer = await sessionBuyer();
    if (!buyer) return { ok: false, message: "Sign in to report a problem." };
    const trials = await import("./trials");
    const r = trials.fileComplaint(buyer.id, String(data.code ?? ""), String(data.reason ?? ""));
    return r.ok
      ? { ok: true, message: "Thanks — we've recorded your report and our team will review it." }
      : { ok: false, message: r.message };
  });

// ------------------------------------------------------------------- vendor

function toCents(raw: unknown): number {
  const text = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!text) return Number.NaN;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
function toDateIso(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00.000Z`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
const cents = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export const fetchTrialState = createServerFn({ method: "GET" }).handler(async (): Promise<TrialState | null> => {
  const vendor = await sessionVendor();
  if (!vendor) return null;
  const [trials, ts, stripe, { getDb }] = await Promise.all([
    import("./trials"),
    import("./trial-stripe"),
    import("./stripe"),
    import("./db"),
  ]);
  const { TRIAL } = await import("../lib/trial-rules");
  try {
    trials.sweepTrials();
    await ts.reconcileAbandonedCheckouts();
    if (stripe.stripeEnvStatus().configured) await ts.refreshConnectStatus(vendor.id).catch(() => undefined);
  } catch (e) {
    console.error("[trial] sweep failed:", (e as Error).message);
  }

  const elig = trials.checkEligibility(vendor.id);
  const summary = trials.trialSummary(vendor.id);
  const base = await origin();
  const db = getDb();

  let deal: TrialDealView | null = null;
  let shareKit: TrialState["shareKit"] = null;
  if (summary?.dealId != null) {
    const d = db.query<any, [number]>("SELECT * FROM deals WHERE id = ?").get(summary.dealId);
    if (d) {
      deal = {
        id: d.id,
        slug: d.slug,
        title: d.title,
        description: d.description,
        highlights: (JSON.parse(d.highlights || "[]") as string[]).join("\n"),
        finePrint: d.fine_print,
        price: cents(d.price_cents),
        value: cents(d.value_cents),
        voucherLimit: d.voucher_limit,
        perCustomerLimit: d.per_customer_limit,
        redemptionStart: day(d.redemption_start),
        redemptionEnd: day(d.redemption_end),
        validDays: JSON.parse(d.valid_days || "[]"),
        blackoutDates: (JSON.parse(d.blackout_dates || "[]") as string[]).join("\n"),
        redemptionInstructions: d.redemption_instructions ?? "",
        status: d.status === "published" ? "published" : "paused",
        reviewState: d.review_state,
        reviewNote: d.review_note,
        pausedReason: d.paused_reason,
        publicUrl: `${base}/deals/${d.slug}`,
      };
      if (d.status === "published") {
        const off = Math.round(((d.value_cents - d.price_cents) / d.value_cents) * 100);
        const url = `${base}/deals/${d.slug}`;
        shareKit = {
          url,
          headline: `${d.title} — $${cents(d.price_cents)} (${off}% off)`,
          short: `New at ${vendor.business_name}: ${d.title} for $${cents(d.price_cents)} instead of $${cents(d.value_cents)}. Grab a voucher: ${url}`,
          long: `We just put a deal on Shop My Neighborhood, the Lake County local deals site.\n\n${d.title}\n$${cents(d.price_cents)} (worth $${cents(d.value_cents)} — ${off}% off)\n\nBuy your voucher here and show the code when you visit: ${url}\n\nPlease share with a neighbor!`,
        };
      }
    }
  }

  const neighbors = summary
    ? db
        .query<{ business_name: string; title: string; slug: string }, [string, number]>(
          `SELECT v.business_name, d.title, d.slug FROM deals d
             JOIN free_trials t ON t.id = d.trial_id JOIN vendors v ON v.id = d.vendor_id
            WHERE t.city_slug = ? AND d.status = 'published' AND d.vendor_id != ? ORDER BY d.id DESC LIMIT 6`,
        )
        .all(summary.trial.city_slug, vendor.id)
        .map((r) => ({ name: r.business_name, dealTitle: r.title, slug: r.slug }))
    : [];

  return {
    vendorId: vendor.id,
    businessName: vendor.business_name,
    stripeConfigured: stripe.stripeEnvStatus().configured,
    eligibility: elig.ok ? { ok: true, businessName: elig.business.name } : { ok: false, reason: elig.reason, code: elig.code },
    trial: summary
      ? {
          id: summary.trial.id,
          status: summary.trial.status,
          endReason: summary.trial.end_reason,
          requestedAt: summary.trial.requested_at,
          approvedAt: summary.trial.approved_at,
          expiresAt: summary.trial.expires_at,
          liveDeadlineAt: summary.trial.live_deadline_at,
          firstLiveAt: summary.trial.first_live_at,
          endedAt: summary.trial.ended_at,
          decisionNote: summary.trial.decision_note,
          verifiedSold: summary.verifiedSold,
          heldNow: summary.heldNow,
          soldToday: summary.soldToday,
          daysToLive: summary.daysToLive,
          daysToEnd: summary.daysToEnd,
          stripeConnected: summary.stripeConnected,
          chargesEnabled: summary.chargesEnabled,
        }
      : null,
    deal,
    shareKit,
    limits: {
      maxPriceCents: TRIAL.maxPriceCents,
      maxVouchers: TRIAL.maxVouchers,
      maxPerDay: TRIAL.maxPerDay,
      liveDeadlineDays: TRIAL.liveDeadlineDays,
    },
    neighbors,
  };
});

export const requestFreeTrial = createServerFn({ method: "POST" }).handler(async (): Promise<ActionOutcome> => {
  const vendor = await sessionVendor();
  if (!vendor) return { ok: false, message: "Sign in first." };
  const trials = await import("./trials");
  const r = trials.requestTrial(vendor.id);
  return r.ok
    ? { ok: true, message: "Request sent. We review every request and will email you with the decision." }
    : { ok: false, message: r.message };
});

export type TrialDealInput = {
  title: string;
  description: string;
  highlights: string;
  finePrint: string;
  price: string;
  value: string;
  voucherLimit: string;
  perCustomerLimit: string | number;
  redemptionStart: string;
  redemptionEnd: string;
  validDays: string[];
  blackoutDates: string;
  redemptionInstructions: string;
  acceptTerms: boolean;
};

export const saveTrialDealFn = createServerFn({ method: "POST" })
  .validator((input: TrialDealInput) => input)
  .handler(async ({ data }): Promise<ActionOutcome & { needsReview?: boolean }> => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false, message: "Sign in first." };
    const trials = await import("./trials");
    const draft = {
      title: String(data.title ?? ""),
      description: String(data.description ?? ""),
      highlights: String(data.highlights ?? "").split("\n").map((h) => h.trim()).filter(Boolean).slice(0, 10),
      finePrint: String(data.finePrint ?? ""),
      priceCents: toCents(data.price),
      valueCents: toCents(data.value),
      voucherLimit: Number(String(data.voucherLimit ?? "").trim()),
      perCustomerLimit: Number(String(data.perCustomerLimit ?? "1").trim()),
      redemptionStart: toDateIso(data.redemptionStart),
      redemptionEnd: toDateIso(data.redemptionEnd),
      validDays: Array.isArray(data.validDays) ? data.validDays.map((d) => String(d).trim().toLowerCase()).filter(Boolean) : [],
      blackoutDates: [...new Set(String(data.blackoutDates ?? "").split(/[\n,;]+/).map((d) => d.trim()).filter(Boolean))],
      redemptionInstructions: String(data.redemptionInstructions ?? ""),
      acceptTerms: Boolean(data.acceptTerms),
    };
    const r = trials.saveTrialDeal(vendor.id, draft);
    if (!r.ok) return { ok: false, message: r.fields?.form ?? "Check the highlighted fields.", fields: r.fields };
    return {
      ok: true,
      needsReview: r.needsReview,
      message: r.needsReview
        ? "Saved and sent for review. It goes live after approval (and once Stripe is connected)."
        : "Saved.",
    };
  });

export const beginStripeConnect = createServerFn({ method: "POST" }).handler(
  async (): Promise<ActionOutcome & { url?: string }> => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false, message: "Sign in first." };
    const ts = await import("./trial-stripe");
    const r = await ts.startConnectOnboarding(vendor.id, await origin());
    return r.ok ? { ok: true, message: "Opening Stripe…", url: r.url } : { ok: false, message: r.message };
  },
);

export const refreshStripeStatus = createServerFn({ method: "POST" }).handler(async (): Promise<ActionOutcome> => {
  const vendor = await sessionVendor();
  if (!vendor) return { ok: false, message: "Sign in first." };
  const ts = await import("./trial-stripe");
  try {
    const s = await ts.refreshConnectStatus(vendor.id);
    return {
      ok: true,
      message: !s.connected
        ? "Stripe isn't connected yet."
        : s.chargesEnabled
          ? "Stripe is connected and ready to take payments."
          : "Stripe is connected but still needs details before it can take payments.",
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
});

export const setTrialPaused = createServerFn({ method: "POST" })
  .validator((input: { paused: boolean }) => input)
  .handler(async ({ data }): Promise<ActionOutcome> => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false, message: "Sign in first." };
    const trials = await import("./trials");
    const r = trials.vendorSetTrialDealPaused(vendor.id, Boolean(data.paused));
    return r.ok ? { ok: true, message: data.paused ? "Deal paused." : "Deal is live." } : { ok: false, message: r.message };
  });

export const endMyTrial = createServerFn({ method: "POST" }).handler(async (): Promise<ActionOutcome> => {
  const vendor = await sessionVendor();
  if (!vendor) return { ok: false, message: "Sign in first." };
  const trials = await import("./trials");
  const r = trials.vendorEndTrial(vendor.id);
  return r.ok
    ? { ok: true, message: "Your trial has ended. Vouchers already sold stay redeemable." }
    : { ok: false, message: r.message };
});
