// SERVER-ONLY. Thin data layer over SQLite. Every function returns plain,
// serialisable objects so routes can pass them straight through a server
// function. Swap this file's bodies for Postgres queries later; the shapes stay.

import { getDb } from "./db";
import { tierById } from "../lib/tiers";

export type Deal = {
  id: number;
  slug: string;
  title: string;
  vendor_name: string;
  vendor_city: string;
  category_slug: string;
  description: string;
  highlights: string[];
  fine_print: string;
  price_cents: number;
  value_cents: number;
  voucher_limit: number;
  vouchers_sold: number;
  image_hint: string;
  /** Vendor-uploaded photo (served from /api/photos/:id); NULL = gradient artwork. */
  photo_id: number | null;
  is_sample: boolean;
  /** NULL for seeded sample deals; set for deals a real vendor created. */
  vendor_id: number | null;
  status: "published" | "paused";
  starts_at: string;
  ends_at: string | null;

  // --- how the vendor gets paid, and how we talk to them
  /** The vendor's own payment page — shoppers pay there, never here. */
  payment_link_url: string | null;
  /** Vendor endpoint we POST voucher events to. */
  webhook_url: string | null;
  /** HMAC key for those events; also authenticates the vendor's inbound posts. */
  webhook_secret: string | null;

  // --- the rules that make the voucher sellable
  min_discount_pct: number;
  per_customer_limit: number;
  redemption_start: string | null;
  redemption_end: string | null;
  /** Weekday keys (sun..sat). Empty = any day. */
  valid_days: string[];
  /** YYYY-MM-DD dates when vouchers can't be used. */
  blackout_dates: string[];
  terms_accepted_at: string | null;
  redemption_instructions: string | null;
};

export type VoucherStatus = "pending_payment" | "issued" | "redeemed" | "refunded" | "expired";

export type Voucher = {
  id: number;
  code: string;
  deal_id: number;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  amount_cents: number;
  status: VoucherStatus;
  created_at: string;
  redeemed_at: string | null;
  redeemed_by_vendor_id: number | null;
  /** Short reference the vendor sees on their payment page. */
  order_ref: string | null;
  /** When the vendor's webhook (or the vendor by hand) confirmed the payment. */
  confirmed_at: string | null;
  /** 'webhook' | 'manual' | 'demo' — how the confirmation arrived. */
  confirmed_via: "webhook" | "manual" | "demo" | null;
  confirmed_by_vendor_id: number | null;
  refunded_at: string | null;
  refunded_by_vendor_id: number | null;
  /** 1 when the promotional value had lapsed and only the paid value was used. */
  paid_value_only: number;
};

export type DealRow = Omit<
  Deal,
  "highlights" | "is_sample" | "valid_days" | "blackout_dates"
> & {
  highlights: string;
  is_sample: number;
  valid_days: string | null;
  blackout_dates: string | null;
};

function jsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function hydrate(row: DealRow): Deal {
  return {
    ...row,
    photo_id: row.photo_id ?? null,
    highlights: jsonArray(row.highlights),
    is_sample: Boolean(row.is_sample),
    status: row.status === "paused" ? "paused" : "published",
    valid_days: jsonArray(row.valid_days),
    blackout_dates: jsonArray(row.blackout_dates),
    min_discount_pct: row.min_discount_pct ?? 20,
    per_customer_limit: row.per_customer_limit ?? 1,
    payment_link_url: row.payment_link_url ?? null,
    webhook_url: row.webhook_url ?? null,
    webhook_secret: row.webhook_secret ?? null,
    redemption_start: row.redemption_start ?? null,
    redemption_end: row.redemption_end ?? null,
    terms_accepted_at: row.terms_accepted_at ?? null,
    redemption_instructions: row.redemption_instructions ?? null,
  };
}

export type DealFilters = {
  city?: string;
  category?: string;
  q?: string;
  sort?: "ending-soon" | "biggest-savings" | "default";
  limit?: number;
};

/**
 * SQL predicate for deals that are publicly visible: published, and either a
 * seeded sample deal (vendor_id NULL) or a deal from an active vendor.
 */
const PUBLIC_DEAL_CLAUSE =
  "status = 'published' AND (vendor_id IS NULL OR EXISTS (SELECT 1 FROM vendors v WHERE v.id = deals.vendor_id AND v.is_active = 1))";

/** Vouchers this vendor has sold in the current calendar month (UTC). */
export function vendorMonthlyVoucherCount(vendorId: number): number {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = getDb()
    .query<{ n: number }, [number, string]>(
      `SELECT COALESCE(SUM(v.quantity), 0) AS n
         FROM vouchers v JOIN deals d ON d.id = v.deal_id
        WHERE d.vendor_id = ? AND v.created_at >= ?`,
    )
    .get(vendorId, monthStart);
  return row?.n ?? 0;
}

/** Monthly voucher pool for a vendor, Infinity for Enterprise. */
export function vendorVoucherPool(vendorId: number): number {
  const row = getDb()
    .query<{ tier: string }, [number]>("SELECT tier FROM vendors WHERE id = ?")
    .get(vendorId);
  return tierById(row?.tier).monthlyVoucherPool;
}

export function listDeals(filters: DealFilters = {}): Deal[] {
  const db = getDb();
  // Public listings only ever show published deals whose vendor is active
  // (sample deals have vendor_id NULL and are always live).
  const where: string[] = [PUBLIC_DEAL_CLAUSE];
  const params: (string | number)[] = [];

  if (filters.city) {
    where.push("vendor_city = ?");
    params.push(filters.city);
  }
  if (filters.category) {
    where.push("category_slug = ?");
    params.push(filters.category);
  }
  if (filters.q) {
    where.push("(title LIKE ? OR vendor_name LIKE ? OR description LIKE ?)");
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }

  let order = "vouchers_sold DESC, id ASC";
  if (filters.sort === "ending-soon") {
    // Deals with a real end date first, soonest first; open-ended deals last.
    order = "(ends_at IS NULL) ASC, ends_at ASC, vouchers_sold DESC";
  } else if (filters.sort === "biggest-savings") {
    order = "(value_cents - price_cents) DESC, vouchers_sold DESC";
  }

  const limit = filters.limit ? ` LIMIT ${Math.max(1, Math.floor(filters.limit))}` : "";
  const sql = `SELECT * FROM deals ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}${limit}`;
  const rows = db.query<DealRow, (string | number)[]>(sql).all(...params);
  return rows.map(hydrate);
}

export function getDealBySlug(slug: string): Deal | null {
  const row = getDb().query<DealRow, [string]>("SELECT * FROM deals WHERE slug = ?").get(slug);
  return row ? hydrate(row) : null;
}

export function getDealById(id: number): Deal | null {
  const row = getDb().query<DealRow, [number]>("SELECT * FROM deals WHERE id = ?").get(id);
  return row ? hydrate(row) : null;
}

export function countDeals(): number {
  const row = getDb()
    .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM deals WHERE ${PUBLIC_DEAL_CLAUSE}`)
    .get();
  return row?.n ?? 0;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1

function randomFromAlphabet(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function randomCode(): string {
  const raw = randomFromAlphabet(8);
  return `SMN-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function randomOrderRef(): string {
  return `ORD-${randomFromAlphabet(6)}`;
}

/**
 * Appends reference parameters to a vendor's payment link without breaking a URL
 * that already has a query string or a fragment. Values already present on the
 * link win — we never overwrite what the vendor configured.
 */
export function appendReferenceParams(url: string, params: Record<string, string>): string {
  try {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
    }
    return parsed.toString();
  } catch {
    // Not parseable (shouldn't happen — the URL is validated on save). Leave it
    // alone rather than send the shopper somewhere broken.
    return url;
  }
}

/** Vouchers one email already holds for a deal, counting quantities. */
export function purchasedQuantityForEmail(dealId: number, email: string): number {
  const row = getDb()
    .query<{ n: number | null }, [number, string]>(
      `SELECT COALESCE(SUM(quantity), 0) AS n FROM vouchers
        WHERE deal_id = ? AND LOWER(buyer_email) = ?
          AND status IN ('pending_payment', 'issued', 'redeemed', 'expired')`,
    )
    .get(dealId, email.trim().toLowerCase());
  return row?.n ?? 0;
}

export type CreateVoucherInput = {
  slug: string;
  buyerName: string;
  buyerEmail: string;
  quantity: number;
};

export type CreateVoucherResult =
  | {
      ok: true;
      code: string;
      orderRef: string;
      /** The vendor's payment page with our references appended, or null for a
       *  sample deal (which has no vendor to pay). */
      paymentUrl: string | null;
      /** True when this is a seeded sample deal: issued immediately as a demo,
       *  with no payment involved anywhere. */
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
    };

/**
 * Starts a voucher purchase. Money is NEVER taken here: the row is written as
 * `pending_payment` and the shopper is sent to the vendor's own payment page.
 * Only the vendor's webhook (or the vendor confirming by hand) moves it to
 * `issued`. Seeded sample deals have no vendor and no payment link, so they take
 * the demo path: issued straight away and badged as a demo on every screen.
 *
 * The insert, the sold counter and the audit rows share one transaction so the
 * counter can never drift from the voucher rows or oversell past voucher_limit.
 */
export function createVoucher(input: CreateVoucherInput): CreateVoucherResult {
  const db = getDb();

  const qty = Math.floor(Number(input.quantity));
  if (!Number.isInteger(qty) || qty < 1 || qty > 5) return { ok: false, error: "invalid" };

  const run = db.transaction((data: CreateVoucherInput): CreateVoucherResult => {
    const deal = getDealBySlug(data.slug);
    if (!deal) return { ok: false, error: "not_found" };
    if (deal.status !== "published") return { ok: false, error: "unavailable" };

    const remaining = deal.voucher_limit - deal.vouchers_sold;
    if (remaining <= 0 || qty > remaining) {
      return {
        ok: false,
        error: "sold_out",
        message: `Only ${Math.max(0, remaining)} voucher${remaining === 1 ? "" : "s"} left for this deal.`,
      };
    }

    // Per-customer limit (1–5). Vouchers this email already holds count toward it.
    const perCustomer = deal.per_customer_limit || 1;
    const already = purchasedQuantityForEmail(deal.id, data.buyerEmail);
    if (already + qty > perCustomer) {
      return {
        ok: false,
        error: "customer_limit",
        message:
          already >= perCustomer
            ? `This deal is limited to ${perCustomer} voucher${perCustomer === 1 ? "" : "s"} per customer, and this email has already bought ${already}.`
            : `This deal is limited to ${perCustomer} voucher${perCustomer === 1 ? "" : "s"} per customer. You can still buy ${perCustomer - already}.`,
      };
    }

    // Real vendors are also capped by their plan's monthly voucher pool.
    if (deal.vendor_id != null) {
      const vendor = db
        .query<{ is_active: number; tier: string }, [number]>(
          "SELECT is_active, tier FROM vendors WHERE id = ?",
        )
        .get(deal.vendor_id);
      if (!vendor || !vendor.is_active) return { ok: false, error: "unavailable" };
      const pool = tierById(vendor.tier).monthlyVoucherPool;
      if (vendorMonthlyVoucherCount(deal.vendor_id) + qty > pool) {
        return {
          ok: false,
          error: "pool_exhausted",
          message: "This business has used up its voucher allowance for the month.",
        };
      }
    }

    const amount = deal.price_cents * qty;
    const createdAt = new Date().toISOString();
    const demo = deal.vendor_id == null || !deal.payment_link_url;
    const status: VoucherStatus = demo ? "issued" : "pending_payment";

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode();
      const orderRef = randomOrderRef();
      try {
        const row = db
          .query<
            { id: number },
            [string, number, string, string, number, number, string, string, string, string | null, string | null]
          >(
            `INSERT INTO vouchers
               (code, deal_id, buyer_name, buyer_email, quantity, amount_cents, status,
                created_at, order_ref, confirmed_at, confirmed_via)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
          )
          .get(
            code,
            deal.id,
            data.buyerName,
            data.buyerEmail.trim().toLowerCase(),
            qty,
            amount,
            status,
            createdAt,
            orderRef,
            demo ? createdAt : null,
            demo ? "demo" : null,
          );

        db.query("UPDATE deals SET vouchers_sold = vouchers_sold + ? WHERE id = ?").run(qty, deal.id);

        db.query(
          `INSERT INTO voucher_events (voucher_id, event, actor, vendor_id, note, created_at)
           VALUES (?, 'pending_created', 'buyer', ?, ?, ?)`,
        ).run(
          row!.id,
          deal.vendor_id,
          demo
            ? "Sample deal — demo checkout, no payment taken."
            : `Buyer sent to the vendor's payment page (${orderRef}).`,
          createdAt,
        );

        if (demo) {
          // Nothing was charged and there is no vendor to confirm it, so the
          // demo voucher is issued immediately and labelled as a demo everywhere.
          db.query(
            `INSERT INTO voucher_events (voucher_id, event, actor, vendor_id, note, created_at)
             VALUES (?, 'payment_confirmed', 'system', ?, ?, ?)`,
          ).run(row!.id, deal.vendor_id, "Sample deal — issued without payment.", createdAt);
        }

        return {
          ok: true,
          code,
          orderRef,
          demo,
          paymentUrl: demo
            ? null
            : appendReferenceParams(deal.payment_link_url as string, {
                client_reference_id: code,
                reference: code,
                order_ref: orderRef,
                amount: String(amount),
              }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("UNIQUE") || attempt === 4) throw err;
      }
    }
    return { ok: false, error: "invalid" };
  });

  return run(input);
}

/** Deals carry a signing secret — that must never reach a browser. */
export function toPublicDeal(deal: Deal): Deal {
  return { ...deal, webhook_secret: null, webhook_url: null };
}

export function getVoucherRaw(code: string): Voucher | null {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  return (
    getDb().query<Voucher, [string]>("SELECT * FROM vouchers WHERE code = ?").get(normalized) ?? null
  );
}

export function getVoucherByCode(code: string): { voucher: Voucher; deal: Deal } | null {
  const voucher = getVoucherRaw(code);
  if (!voucher) return null;
  const deal = getDealById(voucher.deal_id);
  if (!deal) return null;
  return { voucher, deal: toPublicDeal(deal) };
}
