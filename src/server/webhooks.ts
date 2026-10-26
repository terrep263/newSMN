// SERVER-ONLY. Outbound voucher webhooks.
//
// We never handle voucher money, so the only way a vendor's own payment platform
// and this marketplace stay in step is by telling each other what happened. When
// a voucher is created (pending) and again when it is confirmed, we POST a signed
// JSON body to the vendor's endpoint:
//
//   POST <deal.webhook_url>
//   Content-Type: application/json
//   X-SMN-Signature: sha256=<hex HMAC-SHA256 of the raw body using deal.webhook_secret>
//   X-SMN-Event: voucher.payment_confirmed
//
// Delivery never blocks the shopper: the request that created the voucher returns
// as soon as the row is written, and the POST happens in the background with one
// retry after a short backoff. Failures are logged, never thrown.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** One of the events this marketplace sends out. */
export type OutboundEvent =
  | "voucher.pending_created"
  | "voucher.payment_confirmed"
  | "voucher.refunded";

export type WebhookVoucher = {
  code: string;
  order_ref: string | null;
  status: string;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  amount_cents: number;
  created_at: string;
  confirmed_at: string | null;
  confirmed_via: string | null;
};

export type WebhookDeal = {
  slug: string;
  title: string;
  vendor_name: string;
  payment_link_url: string | null;
};

/** A fresh signing secret for a deal, shown to the vendor on the deal page. */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function signPayload(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/** Constant-time check of an `X-SMN-Signature` header. Accepts the bare hex too. */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const provided = header.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Public origin used in links we hand to vendors and shoppers. */
export function siteOrigin(): string {
  const explicit = (process.env.SITE_ORIGIN ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return "https://shopmyneighborhood.com";
}

export function voucherReturnUrl(code: string): string {
  return `${siteOrigin()}/voucher/${encodeURIComponent(code)}/return`;
}

export function voucherPageUrl(code: string): string {
  return `${siteOrigin()}/voucher/${encodeURIComponent(code)}`;
}

/** The exact body we POST. Documented for vendors on the deal page. */
export function buildPayload(
  event: OutboundEvent,
  voucher: WebhookVoucher,
  deal: WebhookDeal,
): Record<string, unknown> {
  return {
    event,
    sent_at: new Date().toISOString(),
    code: voucher.code,
    order_ref: voucher.order_ref,
    status: voucher.status,
    deal_title: deal.title,
    deal_slug: deal.slug,
    vendor_name: deal.vendor_name,
    buyer_name: voucher.buyer_name,
    buyer_email: voucher.buyer_email,
    quantity: voucher.quantity,
    amount_cents: voucher.amount_cents,
    currency: "USD",
    created_at: voucher.created_at,
    confirmed_at: voucher.confirmed_at,
    confirmed_via: voucher.confirmed_via,
    voucher_url: voucherPageUrl(voucher.code),
    // Where the vendor's payment page should send the shopper back to.
    return_url: voucherReturnUrl(voucher.code),
  };
}

export type WebhookTarget = { url: string | null; secret: string | null };

/**
 * Fire-and-forget delivery. Never awaited by a request handler, so a slow or
 * broken vendor endpoint can't hold up a shopper's checkout.
 */
export function queueVoucherWebhook(
  target: WebhookTarget,
  event: OutboundEvent,
  voucher: WebhookVoucher,
  deal: WebhookDeal,
): void {
  const url = target.url?.trim();
  const secret = target.secret?.trim();
  if (!url) return; // vendor hasn't wired an endpoint — nothing to send
  if (!secret) {
    console.warn(`[webhook] ${event} for ${voucher.code}: deal has no webhook secret, skipped`);
    return;
  }
  const payload = buildPayload(event, voucher, deal);
  void deliver(url, secret, event, voucher.code, payload).catch((err) => {
    console.error(`[webhook] ${event} for ${voucher.code} failed:`, (err as Error).message);
  });
}

async function post(
  url: string,
  body: string,
  signature: string,
  event: OutboundEvent,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ShopMyNeighborhood-Webhooks/1.0",
      "x-smn-event": event,
      "x-smn-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`endpoint answered ${res.status}`);
}

async function deliver(
  url: string,
  secret: string,
  event: OutboundEvent,
  code: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);

  try {
    await post(url, body, signature, event);
    return;
  } catch (err) {
    console.warn(
      `[webhook] ${event} for ${code} attempt 1 failed (${(err as Error).message}) — retrying in 2s`,
    );
  }

  // One retry, short backoff. After this the vendor has the voucher in their
  // dashboard and can confirm manually, so we stop rather than hammer them.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  try {
    await post(url, body, signature, event);
    console.info(`[webhook] ${event} for ${code} delivered on retry`);
  } catch (err) {
    console.error(`[webhook] ${event} for ${code} gave up after retry:`, (err as Error).message);
  }
}
