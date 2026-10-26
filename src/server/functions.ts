// Server functions (RPC) used by the marketplace routes. Handlers import the
// SQLite repository dynamically so `bun:sqlite` never reaches the client bundle.

import { createServerFn } from "@tanstack/react-start";

import type { Deal, Voucher } from "./repository";

export type { Deal, Voucher };

export type DealListInput = {
  city?: string;
  category?: string;
  q?: string;
  sort?: "ending-soon" | "biggest-savings" | "default";
};

export const fetchDeals = createServerFn({ method: "GET" })
  .validator((input: DealListInput) => input)
  .handler(async ({ data }) => {
    const { listDeals, toPublicDeal } = await import("./repository");
    return listDeals({
      city: data.city || undefined,
      category: data.category || undefined,
      q: data.q || undefined,
      sort: data.sort,
    }).map(toPublicDeal);
  });

export const fetchDeal = createServerFn({ method: "GET" })
  .validator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { getDealBySlug, toPublicDeal } = await import("./repository");
    const deal = getDealBySlug(data.slug);
    // Paused deals are not for sale, so they don't get a public page.
    if (!deal || deal.status !== "published") return null;
    // The webhook secret stays on the server — this object is rendered in the
    // browser and would otherwise hand the signing key to every visitor.
    return toPublicDeal(deal);
  });

export const fetchHomeData = createServerFn({ method: "GET" }).handler(async () => {
  const { listDeals, countDeals, toPublicDeal } = await import("./repository");
  return {
    featured: listDeals({ limit: 6 }).map(toPublicDeal),
    totalDeals: countDeals(),
  };
});

export type PurchaseResult =
  | {
      ok: true;
      code: string;
      orderRef: string;
      /** Where the shopper pays the vendor. Null for a sample deal (demo path). */
      paymentUrl: string | null;
      demo: boolean;
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "sold_out"
        | "invalid"
        | "unavailable"
        | "pool_exhausted"
        | "customer_limit";
      message?: string;
      fields?: Record<string, string>;
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const purchaseVoucher = createServerFn({ method: "POST" })
  .validator(
    (input: { slug: string; buyerName: string; buyerEmail: string; quantity: number | string }) => input,
  )
  .handler(async ({ data }): Promise<PurchaseResult> => {
    const fields: Record<string, string> = {};

    const slug = String(data.slug ?? "").trim();
    if (!slug) return { ok: false, error: "not_found" };

    const buyerName = String(data.buyerName ?? "").trim().replace(/\s+/g, " ");
    if (buyerName.length < 2) fields.buyerName = "Please enter your full name.";
    else if (buyerName.length > 80) fields.buyerName = "Name must be 80 characters or fewer.";

    const buyerEmail = String(data.buyerEmail ?? "").trim().toLowerCase();
    if (!buyerEmail) fields.buyerEmail = "Please enter an email address.";
    else if (buyerEmail.length > 160 || !EMAIL_RE.test(buyerEmail))
      fields.buyerEmail = "That email address doesn't look right.";

    const quantity = Number(data.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5)
      fields.quantity = "Choose a quantity between 1 and 5.";

    if (Object.keys(fields).length > 0) return { ok: false, error: "invalid", fields };

    const { createVoucher } = await import("./repository");
    const result = createVoucher({ slug, buyerName, buyerEmail, quantity });
    if (!result.ok) return result;

    // Tell the vendor their side that a voucher now exists, signed with their
    // deal's webhook secret. Fire and forget: the shopper never waits on it.
    if (!result.demo) {
      try {
        const { sendPendingWebhook } = await import("./voucher-lifecycle");
        sendPendingWebhook(result.code);
      } catch (err) {
        console.error("[purchase] pending webhook failed:", (err as Error).message);
      }
    }

    return {
      ok: true,
      code: result.code,
      orderRef: result.orderRef,
      paymentUrl: result.paymentUrl,
      demo: result.demo,
    };
  });

export type PublicVoucherData = {
  voucher: Voucher;
  deal: Deal;
  refund: { allowed: boolean; reason: string; deadline: string };
  /** True when the promo value lapsed but the paid value is still good. */
  promoExpired: boolean;
};

export const fetchVoucher = createServerFn({ method: "GET" })
  .validator((input: { code: string }) => input)
  .handler(async ({ data }): Promise<PublicVoucherData | null> => {
    const [{ getVoucherByCode }, lifecycle] = await Promise.all([
      import("./repository"),
      import("./voucher-lifecycle"),
    ]);
    // Vouchers whose promotional value has lapsed are marked on read so the
    // shopper's page and the vendor's report agree without a cron job.
    try {
      lifecycle.expireDueVouchers();
    } catch (err) {
      console.error("[voucher] expiry sweep failed:", (err as Error).message);
    }
    const found = getVoucherByCode(data.code);
    if (!found) return null;
    const state = lifecycle.refundState(found.voucher);
    const end = found.deal.redemption_end;
    const today = lifecycle.localDay().isoDay;
    return {
      voucher: found.voucher,
      deal: found.deal,
      refund: { allowed: state.allowed, reason: state.reason, deadline: state.deadline },
      promoExpired: Boolean(end && today > end.slice(0, 10)),
    };
  });
