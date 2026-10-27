// SERVER-ONLY. The voucher lifecycle and its audit trail.
//
//   pending_payment → issued → redeemed
//                   ↘ refunded      ↘ refunded (only inside 24h, only unredeemed)
//   issued          → expired (promotional value lapsed; paid value does not)
//   expired         → redeemed (paid-value-only redemption, recorded as such)
//
// Every transition happens in one place so it always writes a voucher_events row
// and always sends the vendor a webhook. Nothing here moves money: the vendor
// takes the payment on their own page, and a refund here is only a record that
// the vendor is returning it through their own provider.

import { getDb } from "./db";
import { sendMailInBackground, voucherSoldEmail } from "./mail";
import {
  getDealById,
  getVoucherRaw,
  type Deal,
  type Voucher,
  type VoucherStatus,
} from "./repository";
import {
  queueVoucherWebhook,
  type OutboundEvent,
  type WebhookDeal,
  type WebhookVoucher,
} from "./webhooks";
import { WEEKDAYS, isoDayLabel, weekdayByJsDay, weekdayByKey, validDaysLabel } from "../lib/deal-rules";

export type VoucherEventActor = "buyer" | "vendor" | "system";

export type VoucherEventRow = {
  id: number;
  voucher_id: number;
  event: string;
  actor: VoucherEventActor;
  vendor_id: number | null;
  note: string | null;
  created_at: string;
};

/** The refund window, in hours, counted from the moment the voucher was created. */
export const REFUND_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

/** Lake County is Eastern; redemption days are judged on the vendor's clock. */
const LOCAL_TZ = "America/New_York";

export function recordEvent(
  voucherId: number,
  event: string,
  actor: VoucherEventActor,
  vendorId: number | null,
  note: string | null,
  at: string = new Date().toISOString(),
): void {
  getDb()
    .query(
      `INSERT INTO voucher_events (voucher_id, event, actor, vendor_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(voucherId, event, actor, vendorId, note, at);
}

export function getVoucherEvents(voucherId: number): VoucherEventRow[] {
  return getDb()
    .query<VoucherEventRow, [number]>(
      "SELECT * FROM voucher_events WHERE voucher_id = ? ORDER BY id ASC",
    )
    .all(voucherId);
}

// ---------------------------------------------------------------- local days

/** "2026-03-04" and the weekday key ("wed") for a Date, in Lake County time. */
export function localDay(at: Date | number = new Date()): { isoDay: string; weekdayKey: string } {
  const d = typeof at === "number" ? new Date(at) : at;
  const isoDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    weekday: "short",
  }).format(d);
  const byName = WEEKDAYS.find((w) => w.short.toLowerCase() === weekdayShort.toLowerCase());
  return { isoDay, weekdayKey: byName?.key ?? weekdayByJsDay(d.getDay())?.key ?? "" };
}

export function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Human date for a stored ISO timestamp, in Lake County time. */
export function localDateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: LOCAL_TZ,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ------------------------------------------------------------------ refunds

export type RefundState = {
  /** True when a refund is still possible right now. */
  allowed: boolean;
  /** Why it is allowed / refused, in plain language. */
  reason: string;
  /** ISO timestamp when the 24-hour window closes. */
  deadline: string;
  hoursLeft: number;
};

/**
 * THE REFUND RULE: unredeemed and no more than 24 hours since purchase.
 * Everything that wants to refund (or explain a refund) goes through this.
 */
export function refundState(voucher: Voucher, now: number = Date.now()): RefundState {
  const deadlineMs = new Date(voucher.created_at).getTime() + REFUND_WINDOW_HOURS * HOUR_MS;
  const deadline = new Date(deadlineMs).toISOString();
  const hoursLeft = Math.max(0, (deadlineMs - now) / HOUR_MS);

  if (voucher.status === "redeemed") {
    return {
      allowed: false,
      deadline,
      hoursLeft,
      reason: `That voucher was redeemed on ${localDateLabel(voucher.redeemed_at)}, so it can't be refunded.`,
    };
  }
  if (voucher.status === "refunded") {
    return {
      allowed: false,
      deadline,
      hoursLeft,
      reason: `That voucher was already marked refunded on ${localDateLabel(voucher.refunded_at)}.`,
    };
  }
  if (now > deadlineMs) {
    const hoursAgo = Math.floor((now - deadlineMs) / HOUR_MS);
    return {
      allowed: false,
      deadline,
      hoursLeft: 0,
      reason:
        `The ${REFUND_WINDOW_HOURS}-hour refund window closed on ${localDateLabel(deadline)} ` +
        `(${hoursAgo + REFUND_WINDOW_HOURS} hours after purchase). Vouchers can only be refunded within ` +
        `${REFUND_WINDOW_HOURS} hours of buying them, and only while they're unused.`,
    };
  }
  return {
    allowed: true,
    deadline,
    hoursLeft,
    reason:
      voucher.status === "pending_payment"
        ? `Unpaid and unused — it can still be refunded until ${localDateLabel(deadline)}.`
        : `Unused — it can still be refunded until ${localDateLabel(deadline)}.`,
  };
}

export type RefundResult =
  | { ok: true; voucher: Voucher; note: string }
  | { ok: false; error: "not_found" | "other_vendor" | "not_refundable"; message: string };

/**
 * Marks a voucher refunded on behalf of the owning vendor. We never held the
 * money, so this is a record, not a payment reversal — the vendor returns the
 * money through their own payment provider.
 */
export function markVoucherRefunded(
  code: string,
  vendorId: number,
  now: number = Date.now(),
): RefundResult {
  const db = getDb();
  const voucher = getVoucherRaw(code);
  if (!voucher) {
    return { ok: false, error: "not_found", message: "No voucher found with that code." };
  }
  const deal = getDealById(voucher.deal_id);
  if (!deal) {
    return { ok: false, error: "not_found", message: "No voucher found with that code." };
  }
  if (deal.vendor_id !== vendorId) {
    return {
      ok: false,
      error: "other_vendor",
      message: "That voucher belongs to another business, so it can't be refunded here.",
    };
  }

  const state = refundState(voucher, now);
  if (!state.allowed) {
    return { ok: false, error: "not_refundable", message: state.reason };
  }

  const at = new Date(now).toISOString();
  const changed = db
    .query(
      `UPDATE vouchers
          SET status = 'refunded', refunded_at = ?, refunded_by_vendor_id = ?
        WHERE id = ? AND status IN ('pending_payment', 'issued') AND refunded_at IS NULL`,
    )
    .run(at, vendorId, voucher.id);
  if (changed.changes === 0) {
    return {
      ok: false,
      error: "not_refundable",
      message: "That voucher changed a moment ago and can no longer be refunded.",
    };
  }

  recordEvent(
    voucher.id,
    "refunded",
    "vendor",
    vendorId,
    `Marked refunded by the vendor. The vendor returns the ${voucher.amount_cents} in voucher money through their own payment provider.`,
    at,
  );

  const after = getVoucherRaw(voucher.code)!;
  sendWebhook(deal, after, "voucher.refunded");
  return {
    ok: true,
    voucher: after,
    note: "Marked refunded. The vendor returns the money through their own payment provider.",
  };
}

// ------------------------------------------------------------------ expiry

/**
 * Vouchers whose redemption window has closed stop carrying promotional value.
 * Their paid value never expires, so the row is marked `expired` (promotional
 * value gone) rather than thrown away, and it can still be redeemed at face value.
 */
export function expireDueVouchers(now: number = Date.now()): number {
  const db = getDb();
  const today = localDay(now).isoDay;
  const rows = db
    .query<{ id: number; code: string; deal_id: number; vendor_id: number | null; redemption_end: string }, [string]>(
      `SELECT v.id, v.code, v.deal_id, d.vendor_id, d.redemption_end
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE v.status = 'issued' AND d.redemption_end IS NOT NULL AND substr(d.redemption_end, 1, 10) < ?`,
    )
    .all(today);

  const at = new Date(now).toISOString();
  for (const row of rows) {
    const changed = db
      .query("UPDATE vouchers SET status = 'expired' WHERE id = ? AND status = 'issued'")
      .run(row.id);
    if (changed.changes === 0) continue;
    recordEvent(
      row.id,
      "expired",
      "system",
      row.vendor_id,
      `Promotional value expired on ${isoDayLabel(row.redemption_end)}. The paid value does not expire.`,
      at,
    );
  }
  return rows.length;
}

// -------------------------------------------------------------- confirmation

export type ConfirmResult =
  | { ok: true; voucher: Voucher; deal: Deal; via: "webhook" | "manual" }
  | { ok: false; error: "not_found" | "wrong_state" | "no_secret" | "bad_signature"; message: string };

function sendWebhook(deal: Deal, voucher: Voucher, event: OutboundEvent): void {
  const target = { url: deal.webhook_url, secret: deal.webhook_secret };
  if (!target.url) return;
  const payloadVoucher: WebhookVoucher = {
    code: voucher.code,
    order_ref: voucher.order_ref,
    status: voucher.status,
    buyer_name: voucher.buyer_name,
    buyer_email: voucher.buyer_email,
    quantity: voucher.quantity,
    amount_cents: voucher.amount_cents,
    created_at: voucher.created_at,
    confirmed_at: voucher.confirmed_at,
    confirmed_via: voucher.confirmed_via,
  };
  const payloadDeal: WebhookDeal = {
    slug: deal.slug,
    title: deal.title,
    vendor_name: deal.vendor_name,
    payment_link_url: deal.payment_link_url,
  };
  queueVoucherWebhook(target, event, payloadVoucher, payloadDeal);
}

/** Emails the vendor that a voucher was confirmed. Sample deals have no vendor and send nothing. */
function notifyVendorOfConfirmedVoucher(deal: Deal, voucher: Voucher): void {
  try {
    if (deal.vendor_id == null) return;
    const vendor = getDb().query<{ email: string }, [number]>("SELECT email FROM vendors WHERE id = ?").get(deal.vendor_id);
    if (!vendor) return;
    sendMailInBackground(voucherSoldEmail({
      to: vendor.email, dealTitle: deal.title, code: voucher.code,
      buyerName: voucher.buyer_name, quantity: voucher.quantity, amountCents: voucher.amount_cents,
    }));
  } catch (error) {
    console.error("[mail] voucher notification skipped:", (error as Error).message);
  }
}

/** Sends the "your voucher exists, here's what to confirm" event. */
export function sendPendingWebhook(code: string): void {
  const voucher = getVoucherRaw(code);
  if (!voucher) return;
  const deal = getDealById(voucher.deal_id);
  if (!deal) return;
  sendWebhook(deal, voucher, "voucher.pending_created");
}

export type ConfirmInput = {
  code: string;
  via: "webhook" | "manual";
  /** The vendor confirming by hand; null for the vendor's webhook. */
  vendorId?: number | null;
  note?: string;
  now?: number;
};

/**
 * Moves a voucher from pending_payment to issued. This is the only thing that
 * ever marks a voucher as paid, and it can only happen on the vendor's say-so —
 * either their signed webhook or their own click in the dashboard.
 */
export function confirmVoucherPayment(input: ConfirmInput): ConfirmResult {
  const db = getDb();
  const voucher = getVoucherRaw(input.code);
  if (!voucher) {
    return { ok: false, error: "not_found", message: "No voucher found with that code." };
  }
  const deal = getDealById(voucher.deal_id);
  if (!deal) {
    return { ok: false, error: "not_found", message: "No voucher found with that code." };
  }
  if (input.vendorId != null && deal.vendor_id !== input.vendorId) {
    return {
      ok: false,
      error: "not_found",
      message: "That voucher belongs to another business.",
    };
  }

  if (voucher.status === "issued" || voucher.status === "redeemed") {
    // Idempotent: a vendor retrying their webhook should not be an error.
    return {
      ok: false,
      error: "wrong_state",
      message:
        voucher.confirmed_at
          ? `That voucher was already confirmed on ${localDateLabel(voucher.confirmed_at)} (${voucher.confirmed_via ?? "manual"}).`
          : "That voucher is already confirmed.",
    };
  }
  if (voucher.status === "refunded") {
    return {
      ok: false,
      error: "wrong_state",
      message: `That voucher was marked refunded on ${localDateLabel(voucher.refunded_at)}, so it can't be confirmed.`,
    };
  }
  if (voucher.status === "expired") {
    return {
      ok: false,
      error: "wrong_state",
      message: "That voucher's promotional value already expired and it was never marked paid.",
    };
  }

  const at = new Date(input.now ?? Date.now()).toISOString();
  const changed = db
    .query(
      `UPDATE vouchers
          SET status = 'issued', confirmed_at = ?, confirmed_via = ?, confirmed_by_vendor_id = ?
        WHERE id = ? AND status = 'pending_payment'`,
    )
    .run(at, input.via, input.vendorId ?? null, voucher.id);
  if (changed.changes === 0) {
    return {
      ok: false,
      error: "wrong_state",
      message: "That voucher changed a moment ago — refresh and try again.",
    };
  }

  recordEvent(
    voucher.id,
    "payment_confirmed",
    input.via === "webhook" ? "system" : "vendor",
    input.vendorId ?? null,
    input.note ??
      (input.via === "webhook"
        ? "Payment confirmed by the vendor's webhook."
        : "Payment confirmed by the vendor in their dashboard."),
    at,
  );

  const after = getVoucherRaw(voucher.code)!;
  sendWebhook(deal, after, "voucher.payment_confirmed");
  notifyVendorOfConfirmedVoucher(deal, after);
  return { ok: true, voucher: after, deal, via: input.via };
}

// --------------------------------------------------------------- redemption

export type RedemptionCheck =
  | { ok: true; paidValueOnly: boolean; note: string }
  | {
      ok: false;
      error:
        | "unknown"
        | "other_vendor"
        | "sample_deal"
        | "not_confirmed"
        | "already_redeemed"
        | "refunded"
        | "expired"
        | "before_window"
        | "after_window"
        | "invalid_day"
        | "blackout";
      message: string;
    };

/**
 * Every rule that decides whether a code can be redeemed right now, in plain
 * language. Shared by the lookup screen and the redeem action so the vendor sees
 * the same reason before and after they press the button.
 */
export function checkRedemption(
  voucher: Voucher,
  deal: Deal,
  now: number = Date.now(),
): RedemptionCheck {
  const { isoDay, weekdayKey } = localDay(now);

  if (voucher.status === "redeemed") {
    return {
      ok: false,
      error: "already_redeemed",
      message: `That voucher was already redeemed on ${localDateLabel(voucher.redeemed_at)}.`,
    };
  }
  if (voucher.status === "refunded") {
    return {
      ok: false,
      error: "refunded",
      message: `That voucher was marked refunded on ${localDateLabel(voucher.refunded_at)} — it can't be used.`,
    };
  }
  if (voucher.status === "pending_payment") {
    return {
      ok: false,
      error: "not_confirmed",
      message:
        "The payment for this voucher hasn't been confirmed yet. Confirm it in your dashboard (or let your webhook do it) before redeeming.",
    };
  }

  const start = dayOf(deal.redemption_start);
  const end = dayOf(deal.redemption_end);

  if (voucher.status === "expired" || (end && isoDay > end)) {
    // Paid value never expires — the vendor can still take it at face value.
    return {
      ok: true,
      paidValueOnly: true,
      note: `Promotional value expired on ${isoDayLabel(end)} — the ${(voucher.amount_cents / 100).toFixed(2)} paid is still redeemable at face value.`,
    };
  }

  if (start && isoDay < start) {
    return {
      ok: false,
      error: "before_window",
      message: `This voucher can't be used until ${isoDayLabel(start)}.`,
    };
  }

  const validDays = deal.valid_days;
  if (validDays.length > 0 && !validDays.includes(weekdayKey)) {
    const dayName = weekdayByKey(weekdayKey)?.name ?? "that day";
    return {
      ok: false,
      error: "invalid_day",
      message: `This voucher can't be used on a ${dayName}. It's valid ${validDaysLabel(validDays)}.`,
    };
  }

  if (deal.blackout_dates.includes(isoDay)) {
    return {
      ok: false,
      error: "blackout",
      message: `Blacked out on ${isoDayLabel(isoDay)} — the vendor doesn't accept vouchers that day.`,
    };
  }

  return { ok: true, paidValueOnly: false, note: "Valid to redeem today." };
}

export type RedeemOutcome =
  | { ok: true; voucher: Voucher; paidValueOnly: boolean }
  | { ok: false; error: string; message: string };

/**
 * Redeems a code for the owning vendor. The UPDATE is scoped by vendor_id and by
 * status, so two concurrent redemptions can never both succeed and one business
 * can never redeem another's voucher.
 */
export function redeemVoucherCode(
  vendorId: number,
  rawCode: string,
  options: { paidValueOnly?: boolean; now?: number } = {},
): RedeemOutcome {
  const db = getDb();
  const code = String(rawCode ?? "").trim().toUpperCase();
  if (!code) return { ok: false, error: "unknown", message: "Enter the voucher code first." };

  // NOTE: db.transaction() returns a wrapper — it has to be *called*, otherwise
  // this function hands back a function object and every redemption silently
  // reports ok:false with no message.
  const run = db.transaction((): RedeemOutcome => {
    const voucher = getVoucherRaw(code);
    if (!voucher) {
      return {
        ok: false,
        error: "unknown",
        message: `No voucher found with the code ${code}. Check the code and try again.`,
      };
    }
    const deal = getDealById(voucher.deal_id);
    if (!deal) return { ok: false, error: "unknown", message: "No voucher found with that code." };
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

    const check = checkRedemption(voucher, deal, options.now ?? Date.now());
    if (!check.ok) return { ok: false, error: check.error, message: check.message };

    // No "must opt in" gate here: the paid value never expires, so once the
    // promotional window has closed the voucher is still worth what the buyer
    // paid and is recorded as a paid-value-only redemption. Refusing would be
    // failing the shopper outright; the caller can still ask for the flag
    // explicitly (options.paidValueOnly) but it cannot turn this into an error.

    const at = new Date(options.now ?? Date.now()).toISOString();
    const changed = db
      .query(
        `UPDATE vouchers
            SET status = 'redeemed', redeemed_at = ?, redeemed_by_vendor_id = ?, paid_value_only = ?
          WHERE id = ? AND status IN ('issued', 'expired')`,
      )
      .run(at, vendorId, check.paidValueOnly ? 1 : 0, voucher.id);
    if (changed.changes === 0) {
      return {
        ok: false,
        error: "already_redeemed",
        message: "That voucher was redeemed a moment ago.",
      };
    }

    recordEvent(
      voucher.id,
      "redeemed",
      "vendor",
      vendorId,
      check.paidValueOnly
        ? `Paid-value-only redemption after the promotional value lapsed. ${check.note}`
        : "Redeemed in store by the vendor.",
      at,
    );

    return {
      ok: true,
      voucher: getVoucherRaw(code)!,
      paidValueOnly: check.paidValueOnly,
    };
  });
  return run();
}

// ------------------------------------------------------------------- reports

export type VoucherReport = {
  /** Confirmed vouchers (issued + redeemed + expired) plus refunded ones. */
  sold: number;
  pending: number;
  redeemed: number;
  refunded: number;
  expired: number;
  /** Bought, still unused, promotional value still live. */
  outstanding: number;
  /** Voucher money the vendor reports collecting, in cents. */
  collectedCents: number;
};

const EMPTY_REPORT: VoucherReport = {
  sold: 0,
  pending: 0,
  redeemed: 0,
  refunded: 0,
  expired: 0,
  outstanding: 0,
  collectedCents: 0,
};

function reportFromRows(rows: { status: VoucherStatus; n: number; amount: number }[]): VoucherReport {
  const by = new Map<string, { n: number; amount: number }>();
  for (const row of rows) by.set(row.status, { n: row.n, amount: row.amount });
  const n = (status: VoucherStatus) => by.get(status)?.n ?? 0;
  const amount = (status: VoucherStatus) => by.get(status)?.amount ?? 0;

  const pending = n("pending_payment");
  const issued = n("issued");
  return {
    sold: issued + n("redeemed") + n("expired") + n("refunded"),
    pending,
    redeemed: n("redeemed"),
    refunded: n("refunded"),
    expired: n("expired"),
    outstanding: issued,
    collectedCents: amount("issued") + amount("redeemed") + amount("expired"),
  };
}

function reportRows(where: string, args: (string | number)[]): { status: VoucherStatus; n: number; amount: number }[] {
  return getDb()
    .query<{ status: VoucherStatus; n: number; amount: number }, (string | number)[]>(
      `SELECT v.status AS status, COALESCE(SUM(v.quantity), 0) AS n,
              COALESCE(SUM(v.amount_cents), 0) AS amount
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE ${where}
        GROUP BY v.status`,
    )
    .all(...args);
}

/** Sold / redeemed / refunded / expired / outstanding for one vendor. */
export function vendorVoucherReport(vendorId: number): VoucherReport {
  const rows = reportRows("d.vendor_id = ?", [vendorId]);
  return rows.length === 0 ? { ...EMPTY_REPORT } : reportFromRows(rows);
}

/** The same report scoped to one of the vendor's deals. */
export function dealVoucherReport(vendorId: number, dealId: number): VoucherReport {
  const rows = reportRows("d.vendor_id = ? AND d.id = ?", [vendorId, dealId]);
  return rows.length === 0 ? { ...EMPTY_REPORT } : reportFromRows(rows);
}
