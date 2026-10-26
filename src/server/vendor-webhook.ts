// SERVER-ONLY. The body of POST /api/webhooks/vendor.
//
// It lives here rather than inside the route file so it can be called directly by
// the verification script (scripts/verify-voucher-flow.ts) with a constructed
// Request — no HTTP server, no port, no live database. The route is a two-line
// wrapper that hands its Request straight to handleVendorWebhook().
//
// The vendor's payment platform (or the vendor's own site) calls this to tell us
// what happened to a voucher we issued:
//
//   { "code": "SMN-ABCD-EFGH", "event": "payment_confirmed" | "refunded", "note": "..." }
//
// Authenticated with the deal's webhook secret, either as
//   X-SMN-Signature: sha256=<hmac-sha256 of the raw body>
//   Authorization: Bearer <secret>
//
// payment_confirmed moves a voucher pending_payment -> issued.
// refunded follows the 24-hour rule: allowed only while unused and inside the
// window, and it is recorded as "the vendor returns the money", never as a
// platform refund — we never held the money.

import { createHash, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function normalizeEvent(raw: unknown): "payment_confirmed" | "refunded" | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "payment_confirmed" || value === "voucher.payment_confirmed") return "payment_confirmed";
  if (value === "refunded" || value === "voucher.refunded") return "refunded";
  return null;
}

export async function handleVendorWebhook(request: Request): Promise<Response> {
  const rawBody = await request.text();

  let body: { code?: unknown; event?: unknown; note?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return Response.json({ received: false, error: "bad_json" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) {
    return Response.json({ received: false, error: "missing_code" }, { status: 400 });
  }
  const event = normalizeEvent(body.event);
  if (!event) {
    return Response.json(
      { received: false, error: "unknown_event", allowed: ["payment_confirmed", "refunded"] },
      { status: 400 },
    );
  }

  const repository = await import("./repository");
  const voucher = repository.getVoucherRaw(code);
  if (!voucher) {
    return Response.json({ received: false, error: "unknown_voucher" }, { status: 404 });
  }
  const deal = repository.getDealById(voucher.deal_id);
  if (!deal) {
    return Response.json({ received: false, error: "unknown_voucher" }, { status: 404 });
  }

  const secret = (deal.webhook_secret ?? "").trim();
  if (!secret) {
    console.error(`[vendor-webhook] deal ${deal.slug} has no webhook secret — refusing`);
    return Response.json({ received: false, error: "webhook_not_configured" }, { status: 503 });
  }

  const signature = request.headers.get("x-smn-signature");
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const webhooks = await import("./webhooks");
  const signatureOk = webhooks.verifySignature(rawBody, signature, secret);
  const bearerOk = bearer.length > 0 && safeEqual(bearer, secret);
  if (!signatureOk && !bearerOk) {
    console.warn(`[vendor-webhook] rejected ${event} for ${code}: bad signature`);
    return Response.json({ received: false, error: "bad_signature" }, { status: 401 });
  }

  const lifecycle = await import("./voucher-lifecycle");
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : undefined;

  if (event === "payment_confirmed") {
    const result = lifecycle.confirmVoucherPayment({
      code,
      via: "webhook",
      vendorId: deal.vendor_id,
      note: note ? `Vendor webhook: ${note}` : undefined,
    });
    if (!result.ok) {
      return Response.json(
        { received: true, applied: false, status: result.error, message: result.message },
        { status: 409 },
      );
    }
    return Response.json({
      received: true,
      applied: true,
      code,
      status: result.voucher.status,
      confirmed_via: result.voucher.confirmed_via,
    });
  }

  // refunded
  if (deal.vendor_id == null) {
    return Response.json({ received: false, error: "sample_deal" }, { status: 400 });
  }
  const refunded = lifecycle.markVoucherRefunded(code, deal.vendor_id);
  if (!refunded.ok) {
    return Response.json(
      { received: true, applied: false, error: refunded.error, message: refunded.message },
      { status: 409 },
    );
  }
  return Response.json({
    received: true,
    applied: true,
    code,
    status: refunded.voucher.status,
    message: refunded.note,
  });
}
