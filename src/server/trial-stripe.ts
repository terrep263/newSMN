// SERVER-ONLY. Stripe Connect side of the free trial. Every sale is a direct
// charge on the vendor's own Standard account, with no platform fee: the
// platform never receives, holds or refunds the money. A voucher becomes valid
// only when Stripe itself says the Checkout Session is paid (webhook, or a
// server-side retrieve of the session), never because a browser landed on a
// return URL.

import { getDb } from "./db";
import * as stripe from "./stripe";
import { confirmVoucherPayment, recordEvent } from "./voucher-lifecycle";
import { getVoucherRaw } from "./repository";
import {
  afterVerifiedSale,
  attachCheckoutSession,
  audit,
  createTrialVoucher,
  publishTrialDealIfReady,
  releaseUnpaidTrialVoucher,
  trialDealId,
  trialForVendor,
} from "./trials";
import { TRIAL } from "../lib/trial-rules";

const nowIso = () => new Date().toISOString();

// -------------------------------------------------------------- onboarding

export type ConnectStart = { ok: true; url: string } | { ok: false; message: string };

/** Creates (once) the vendor's own Standard account and returns Stripe's hosted onboarding link. */
export async function startConnectOnboarding(vendorId: number, origin: string): Promise<ConnectStart> {
  if (!stripe.stripeEnvStatus().configured)
    return { ok: false, message: "Payments aren't switched on yet. We'll email you the moment you can connect Stripe." };
  const trial = trialForVendor(vendorId);
  if (!trial || trial.status !== "active")
    return { ok: false, message: "Connecting Stripe opens once your free trial is approved." };
  const db = getDb();
  const v = db
    .query<{ email: string; business_name: string; stripe_connect_account_id: string | null }, [number]>(
      "SELECT email, business_name, stripe_connect_account_id FROM vendors WHERE id = ?",
    )
    .get(vendorId);
  if (!v) return { ok: false, message: "Account not found." };
  try {
    let accountId = v.stripe_connect_account_id;
    if (!accountId) {
      const acct = await stripe.createConnectedAccount({ vendorId, email: v.email, businessName: v.business_name });
      accountId = acct.id;
      db.query("UPDATE vendors SET stripe_connect_account_id = ? WHERE id = ?").run(accountId, vendorId);
      audit(trial.id, `vendor:${vendorId}`, "stripe_account_created", accountId);
    }
    const link = await stripe.createAccountOnboardingLink({
      accountId,
      returnUrl: `${origin}/vendor/trial?stripe=return`,
      refreshUrl: `${origin}/vendor/trial?stripe=refresh`,
    });
    return { ok: true, url: link.url };
  } catch (e) {
    return { ok: false, message: `Stripe couldn't start the connection: ${(e as Error).message}` };
  }
}

/** Pulls the account's state from Stripe and mirrors it; publishes an approved deal if it can now sell. */
export async function refreshConnectStatus(vendorId: number): Promise<{ connected: boolean; chargesEnabled: boolean }> {
  const db = getDb();
  const row = db
    .query<{ stripe_connect_account_id: string | null }, [number]>("SELECT stripe_connect_account_id FROM vendors WHERE id = ?")
    .get(vendorId);
  if (!row?.stripe_connect_account_id) return { connected: false, chargesEnabled: false };
  const acct = await stripe.retrieveConnectedAccount(row.stripe_connect_account_id);
  applyAccountState(acct);
  return { connected: true, chargesEnabled: acct.charges_enabled };
}

export function applyAccountState(acct: stripe.StripeConnectedAccount): void {
  const db = getDb();
  const v = db
    .query<{ id: number }, [string]>("SELECT id FROM vendors WHERE stripe_connect_account_id = ?")
    .get(acct.id);
  if (!v) return;
  db.query("UPDATE vendors SET stripe_connect_charges_enabled = ?, stripe_connect_details_submitted = ? WHERE id = ?").run(
    acct.charges_enabled ? 1 : 0,
    acct.details_submitted ? 1 : 0,
    v.id,
  );
  const trial = trialForVendor(v.id);
  if (trial) {
    audit(trial.id, "stripe", "account_updated", `charges_enabled=${acct.charges_enabled}`);
    const dealId = trialDealId(trial.id);
    if (dealId != null && acct.charges_enabled) publishTrialDealIfReady(dealId);
  }
}

// ---------------------------------------------------------------- checkout

export type CheckoutStart = { ok: true; url: string } | { ok: false; message: string };

export async function startTrialCheckout(input: {
  buyerId: number;
  slug: string;
  quantity: number;
  origin: string;
}): Promise<CheckoutStart> {
  if (!stripe.stripeEnvStatus().configured) return { ok: false, message: "Checkout isn't available right now." };
  const reserved = createTrialVoucher({ slug: input.slug, buyerId: input.buyerId, quantity: input.quantity });
  if (!reserved.ok) return { ok: false, message: reserved.message };
  const buyer = getDb().query<{ email: string }, [number]>("SELECT email FROM buyers WHERE id = ?").get(input.buyerId)!;
  try {
    const session = await stripe.createVendorCheckoutSession({
      accountId: reserved.connectAccountId,
      voucherCode: reserved.code,
      dealTitle: reserved.deal.title,
      vendorName: reserved.deal.vendor_name,
      unitAmountCents: reserved.deal.price_cents,
      quantity: input.quantity,
      customerEmail: buyer.email,
      successUrl: `${input.origin}/voucher/${reserved.code}/return?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${input.origin}/deals/${input.slug}?checkout=cancelled`,
      holdMinutes: TRIAL.checkoutHoldMinutes,
    });
    if (!session.url) throw new Error("Stripe returned no checkout link");
    attachCheckoutSession(reserved.code, session.id, session.expires_at);
    return { ok: true, url: session.url };
  } catch (e) {
    releaseUnpaidTrialVoucher(reserved.code, "could not start checkout");
    return { ok: false, message: `We couldn't start checkout: ${(e as Error).message}` };
  }
}

// ------------------------------------------------------ payment verification

type SessionLike = {
  id: string;
  payment_status: string | null;
  status?: string | null;
  amount_total: number | null;
  currency: string | null;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
};

export type PaymentApply =
  | { ok: true; code: string; state: "confirmed" | "already" }
  | { ok: false; reason: string };

/**
 * Marks a trial voucher paid, but only after checking the session against our
 * own record: paid, same amount, USD, and sent by the vendor's own account.
 */
export function applyPaidSession(session: SessionLike, accountId: string): PaymentApply {
  const code = (session.metadata?.voucher_code ?? session.client_reference_id ?? "").trim().toUpperCase();
  if (!code) return { ok: false, reason: "no voucher code on the session" };
  const voucher = getVoucherRaw(code);
  if (!voucher) return { ok: false, reason: "unknown voucher" };
  const db = getDb();
  const deal = db
    .query<{ id: number; vendor_id: number; trial_id: number | null }, [number]>(
      "SELECT id, vendor_id, trial_id FROM deals WHERE id = ?",
    )
    .get(voucher.deal_id);
  if (!deal || deal.trial_id == null) return { ok: false, reason: "not a trial voucher" };
  const owner = db
    .query<{ stripe_connect_account_id: string | null }, [number]>("SELECT stripe_connect_account_id FROM vendors WHERE id = ?")
    .get(deal.vendor_id);
  if (!owner || owner.stripe_connect_account_id !== accountId)
    return { ok: false, reason: "session came from a different Stripe account" };
  if (session.payment_status !== "paid") return { ok: false, reason: "session is not paid" };
  if (session.amount_total !== voucher.amount_cents || (session.currency ?? "").toLowerCase() !== "usd")
    return { ok: false, reason: "amount or currency does not match the voucher" };

  const stored = db
    .query<{ stripe_session_id: string | null; stripe_payment_intent: string | null }, [string]>(
      "SELECT stripe_session_id, stripe_payment_intent FROM vouchers WHERE code = ?",
    )
    .get(code)!;
  if (stored.stripe_session_id && stored.stripe_session_id !== session.id)
    return { ok: false, reason: "session does not match this voucher" };
  if (stored.stripe_payment_intent) return { ok: true, code, state: "already" };

  const intent = session.payment_intent ?? `session:${session.id}`;
  const tx = db.transaction((): PaymentApply => {
    if (voucher.status === "expired" && !voucher.confirmed_at) {
      // Released as unpaid, yet Stripe took the money: honour it and take the capacity back.
      db.query("UPDATE vouchers SET status = 'pending_payment' WHERE id = ? AND status = 'expired'").run(voucher.id);
      db.query("UPDATE deals SET vouchers_sold = vouchers_sold + ? WHERE id = ?").run(voucher.quantity, voucher.deal_id);
      recordEvent(voucher.id, "late_payment", "system", deal.vendor_id, "Payment arrived after the checkout hold; the voucher is restored.");
    }
    db.query("UPDATE vouchers SET stripe_session_id = ?, stripe_payment_intent = ? WHERE id = ? AND stripe_payment_intent IS NULL").run(
      session.id,
      intent,
      voucher.id,
    );
    const res = confirmVoucherPayment({ code, via: "stripe" });
    if (!res.ok && res.error !== "wrong_state") return { ok: false, reason: res.message };
    return { ok: true, code, state: "confirmed" };
  });
  const out = tx();
  if (out.ok && out.state === "confirmed") afterVerifiedSale(deal.id);
  return out;
}

/** A full refund reported by Stripe on the vendor's account. Vendors refund in Stripe; we just record it. */
export function applyChargeRefunded(
  charge: { payment_intent?: string | null; refunded?: boolean; amount?: number; amount_refunded?: number },
  accountId: string,
): boolean {
  if (!charge.payment_intent) return false;
  const db = getDb();
  const v = db
    .query<{ id: number; status: string; deal_id: number; vendor_id: number }, [string, string]>(
      `SELECT v.id, v.status, v.deal_id, d.vendor_id FROM vouchers v JOIN deals d ON d.id = v.deal_id
         JOIN vendors x ON x.id = d.vendor_id
        WHERE v.stripe_payment_intent = ? AND x.stripe_connect_account_id = ?`,
    )
    .get(charge.payment_intent, accountId);
  if (!v) return false;
  const full = charge.refunded === true || (charge.amount != null && (charge.amount_refunded ?? 0) >= charge.amount);
  if (!full) {
    recordEvent(v.id, "partial_refund", "system", v.vendor_id, "Stripe reported a partial refund from the vendor's account.");
    return true;
  }
  if (v.status === "issued") {
    db.query("UPDATE vouchers SET status = 'refunded', refunded_at = ? WHERE id = ? AND status = 'issued'").run(nowIso(), v.id);
    recordEvent(v.id, "refunded", "system", v.vendor_id, "Refunded by the vendor in Stripe.");
  } else {
    recordEvent(v.id, "refund_reported", "system", v.vendor_id, `Stripe reported a refund while the voucher was ${v.status}.`);
  }
  return true;
}

// ------------------------------------------------------------- reconcile

/**
 * Settles one pending trial voucher by asking Stripe directly. Paid → confirm.
 * Expired/abandoned → release. Never deletes on a guess: if Stripe can't be
 * reached the voucher stays pending.
 */
export async function reconcileTrialVoucher(code: string): Promise<"confirmed" | "released" | "pending" | "skipped"> {
  const db = getDb();
  const row = db
    .query<
      { stripe_session_id: string | null; status: string; checkout_expires_at: string | null; acct: string | null; trial_id: number | null; stripe_payment_intent: string | null },
      [string]
    >(
      `SELECT v.stripe_session_id, v.status, v.checkout_expires_at, x.stripe_connect_account_id AS acct, d.trial_id, v.stripe_payment_intent
         FROM vouchers v JOIN deals d ON d.id = v.deal_id JOIN vendors x ON x.id = d.vendor_id WHERE v.code = ?`,
    )
    .get(code);
  if (!row || row.trial_id == null || row.status !== "pending_payment" || row.stripe_payment_intent) return "skipped";
  const expired = !!row.checkout_expires_at && row.checkout_expires_at < nowIso();
  if (!row.stripe_session_id || !row.acct) {
    if (expired) return releaseUnpaidTrialVoucher(code, "checkout never started") ? "released" : "pending";
    return "pending";
  }
  if (!stripe.stripeEnvStatus().configured) return "pending";
  try {
    const session = await stripe.retrieveVendorCheckoutSession(row.acct, row.stripe_session_id);
    if (session.payment_status === "paid") {
      return applyPaidSession(session, row.acct).ok ? "confirmed" : "pending";
    }
    if (session.status === "expired") return releaseUnpaidTrialVoucher(code, "checkout expired") ? "released" : "pending";
    if (expired) {
      await stripe.expireVendorCheckoutSession(row.acct, row.stripe_session_id).catch(() => undefined);
      const again = await stripe.retrieveVendorCheckoutSession(row.acct, row.stripe_session_id);
      if (again.payment_status === "paid") return applyPaidSession(again, row.acct).ok ? "confirmed" : "pending";
      if (again.status === "expired") return releaseUnpaidTrialVoucher(code, "checkout expired") ? "released" : "pending";
    }
    return "pending";
  } catch {
    return "pending";
  }
}

/** Sweeps every pending trial voucher past its hold. Safe to run often. */
export async function reconcileAbandonedCheckouts(): Promise<number> {
  const codes = getDb()
    .query<{ code: string }, [string]>(
      `SELECT v.code FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.trial_id IS NOT NULL AND v.status = 'pending_payment' AND v.stripe_payment_intent IS NULL
          AND v.checkout_expires_at < ?`,
    )
    .all(nowIso())
    .map((r) => r.code);
  let n = 0;
  for (const c of codes) if ((await reconcileTrialVoucher(c)) !== "pending") n++;
  return n;
}
