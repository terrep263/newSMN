// SERVER-ONLY. Admin console for the free-trial program. Same ADMIN_CLAIM_TOKEN
// as the claim review, but its cookie is scoped to "/" because server functions
// are called at /_serverFn/... (a path-scoped cookie would not be sent with them).
// Every read and write re-checks the cookie on the server.

import { getCookie, setCookie } from "@tanstack/react-start/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { getDb } from "./db";
import { stripeEnvStatus } from "./stripe";
import * as trials from "./trials";
import { CITIES, categoryName } from "../lib/taxonomy";
import { TRIAL, type TrialEndReason, type TrialStatus } from "../lib/trial-rules";

const COOKIE = "smn_trial_admin";

const secret = (): string | null => process.env.ADMIN_CLAIM_TOKEN?.trim() || null;
const cookieValue = (s: string) => createHmac("sha256", s).update("shop-my-neighborhood:trials-admin").digest("base64url");

export function adminEnabled(): boolean {
  return Boolean(secret());
}

export function isAdmin(): boolean {
  const s = secret();
  if (!s) return false;
  const have = Buffer.from(getCookie(COOKIE) ?? "");
  const want = Buffer.from(cookieValue(s));
  return have.length === want.length && timingSafeEqual(have, want);
}

export function adminLogin(token: string | undefined): { ok: boolean; message: string } {
  const s = secret();
  if (!s) return { ok: false, message: "Not found." };
  const a = Buffer.from(String(token ?? ""));
  const b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, message: "That admin token is not valid." };
  setCookie(COOKIE, cookieValue(s), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 8 * 60 * 60 });
  return { ok: true, message: "Authorized." };
}

export type AdminTrialData = {
  stripeConfigured: boolean;
  funnel: { label: string; count: number }[];
  cities: { slug: string; name: string; cap: number; used: number; requested: number }[];
  requests: { id: number; business: string; vendorEmail: string; city: string; category: string; requestedAt: string; cityFull: boolean; categoryTaken: boolean }[];
  dealReviews: {
    dealId: number; trialId: number; business: string; city: string; category: string; title: string; description: string;
    priceCents: number; valueCents: number; voucherLimit: number; finePrint: string; redemptionInstructions: string;
    redemptionStart: string | null; redemptionEnd: string | null; changed: boolean;
  }[];
  trials: {
    id: number; business: string; city: string; category: string; status: TrialStatus; endReason: TrialEndReason | null;
    approvedAt: string | null; expiresAt: string | null; liveDeadlineAt: string | null; firstLiveAt: string | null;
    verifiedSold: number; dealId: number | null; dealStatus: string | null; pausedReason: string | null; complaints: number; stripeReady: boolean;
  }[];
  alerts: { id: number; kind: string; message: string; createdAt: string; business: string | null }[];
  audit: { at: string; actor: string; action: string; detail: string; business: string | null }[];
};

const one = (sql: string, ...args: (string | number)[]): number => getDb().query<{ n: number }, any[]>(sql).get(...args)?.n ?? 0;

export function loadAdminData(): AdminTrialData {
  trials.sweepTrials();
  const db = getDb();

  const funnel = [
    { label: "Approved listing claims", count: one("SELECT COUNT(*) n FROM listing_claims WHERE status = 'approved'") },
    { label: "Trial requested", count: one("SELECT COUNT(*) n FROM free_trials") },
    { label: "Trial approved", count: one("SELECT COUNT(*) n FROM free_trials WHERE approved_at IS NOT NULL") },
    { label: "Stripe connected", count: one("SELECT COUNT(*) n FROM free_trials t JOIN vendors v ON v.id = t.vendor_id WHERE t.approved_at IS NOT NULL AND v.stripe_connect_charges_enabled = 1") },
    { label: "Deal submitted", count: one("SELECT COUNT(DISTINCT trial_id) n FROM deals WHERE trial_id IS NOT NULL") },
    { label: "Deal approved", count: one("SELECT COUNT(*) n FROM deals WHERE trial_id IS NOT NULL AND review_state = 'approved'") },
    { label: "Deal went live", count: one("SELECT COUNT(*) n FROM free_trials WHERE first_live_at IS NOT NULL") },
    { label: "At least 1 verified sale", count: one("SELECT COUNT(DISTINCT d.trial_id) n FROM vouchers v JOIN deals d ON d.id = v.deal_id WHERE d.trial_id IS NOT NULL AND v.stripe_payment_intent IS NOT NULL") },
    { label: "Sold out (100)", count: one("SELECT COUNT(*) n FROM free_trials WHERE end_reason = 'sold_out'") },
    { label: "Upgraded to paid", count: one("SELECT COUNT(*) n FROM free_trials WHERE end_reason = 'upgraded'") },
    { label: "Lapsed (never live)", count: one("SELECT COUNT(*) n FROM free_trials WHERE status = 'lapsed'") },
  ];

  const cities = CITIES.map((c) => ({
    slug: c.slug,
    name: c.name,
    cap: trials.cityCap(c.slug),
    used: trials.cityUsage(c.slug),
    requested: one("SELECT COUNT(*) n FROM free_trials WHERE city_slug = ? AND status = 'requested'", c.slug),
  })).filter((c) => c.used > 0 || c.requested > 0 || c.slug === "leesburg" || c.cap !== TRIAL.maxPerCity);

  const requests = db
    .query<any, []>(
      `SELECT t.id, t.city_slug, t.category_slug, t.requested_at, b.name AS business, v.email AS vendor_email
         FROM free_trials t JOIN businesses b ON b.id = t.business_id JOIN vendors v ON v.id = t.vendor_id
        WHERE t.status = 'requested' ORDER BY t.requested_at`,
    )
    .all()
    .map((r) => ({
      id: r.id, business: r.business, vendorEmail: r.vendor_email,
      city: CITIES.find((c) => c.slug === r.city_slug)?.name ?? r.city_slug,
      category: categoryName(r.category_slug), requestedAt: r.requested_at,
      cityFull: trials.cityUsage(r.city_slug) >= trials.cityCap(r.city_slug),
      categoryTaken: !!db.query("SELECT 1 FROM free_trials WHERE city_slug = ? AND category_slug = ? AND status IN ('active','ended','terminated')").get(r.city_slug, r.category_slug),
    }));

  const dealReviews = db
    .query<any, []>(
      `SELECT d.id, d.trial_id, d.title, d.description, d.price_cents, d.value_cents, d.voucher_limit, d.fine_print,
              d.redemption_instructions, d.redemption_start, d.redemption_end, d.paused_reason,
              b.name AS business, t.city_slug, t.category_slug
         FROM deals d JOIN free_trials t ON t.id = d.trial_id JOIN businesses b ON b.id = t.business_id
        WHERE d.review_state = 'pending' ORDER BY d.id`,
    )
    .all()
    .map((d) => ({
      dealId: d.id, trialId: d.trial_id, business: d.business,
      city: CITIES.find((c) => c.slug === d.city_slug)?.name ?? d.city_slug, category: categoryName(d.category_slug),
      title: d.title, description: d.description, priceCents: d.price_cents, valueCents: d.value_cents,
      voucherLimit: d.voucher_limit, finePrint: d.fine_print, redemptionInstructions: d.redemption_instructions ?? "",
      redemptionStart: d.redemption_start, redemptionEnd: d.redemption_end,
      changed: d.paused_reason === "changes_pending_review",
    }));

  const trialRows = db
    .query<any, []>(
      `SELECT t.*, b.name AS business, v.stripe_connect_charges_enabled AS charges
         FROM free_trials t JOIN businesses b ON b.id = t.business_id JOIN vendors v ON v.id = t.vendor_id
        WHERE t.status != 'requested' ORDER BY t.id DESC LIMIT 100`,
    )
    .all()
    .map((t) => {
      const dealId = trials.trialDealId(t.id);
      const d = dealId != null ? db.query<any, [number]>("SELECT status, paused_reason FROM deals WHERE id = ?").get(dealId) : null;
      return {
        id: t.id, business: t.business,
        city: CITIES.find((c) => c.slug === t.city_slug)?.name ?? t.city_slug, category: categoryName(t.category_slug),
        status: t.status, endReason: t.end_reason, approvedAt: t.approved_at, expiresAt: t.expires_at,
        liveDeadlineAt: t.live_deadline_at, firstLiveAt: t.first_live_at,
        verifiedSold: dealId != null ? trials.verifiedSold(dealId) : 0, dealId,
        dealStatus: d?.status ?? null, pausedReason: d?.paused_reason ?? null,
        complaints: dealId != null ? one("SELECT COUNT(DISTINCT buyer_id) n FROM trial_complaints WHERE deal_id = ?", dealId) : 0,
        stripeReady: !!t.charges,
      };
    });

  const alerts = db
    .query<any, []>(
      `SELECT a.id, a.kind, a.message, a.created_at, b.name AS business
         FROM trial_alerts a LEFT JOIN free_trials t ON t.id = a.trial_id LEFT JOIN businesses b ON b.id = t.business_id
        WHERE a.resolved_at IS NULL AND a.kind NOT LIKE 'progress_%' ORDER BY a.id DESC LIMIT 100`,
    )
    .all()
    .map((a) => ({ id: a.id, kind: a.kind, message: a.message, createdAt: a.created_at, business: a.business }));

  const audit = db
    .query<any, []>(
      `SELECT x.at, x.actor, x.action, x.detail, b.name AS business
         FROM trial_audit x LEFT JOIN free_trials t ON t.id = x.trial_id LEFT JOIN businesses b ON b.id = t.business_id
        ORDER BY x.id DESC LIMIT 80`,
    )
    .all()
    .map((a) => ({ at: a.at, actor: a.actor, action: a.action, detail: a.detail, business: a.business }));

  return { stripeConfigured: stripeEnvStatus().configured, funnel, cities, requests, dealReviews, trials: trialRows, alerts, audit };
}

export function resolveAlert(id: number): void {
  getDb().query("UPDATE trial_alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").run(new Date().toISOString(), id);
}
