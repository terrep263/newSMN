// Subscription tiers — shared by the public "For Vendors" page, the signup form
// and the server-side limit checks. Safe to import from client and server code
// (no node-only APIs): this file is the single source of truth for the numbers.
//
// CONFIRMED by the owner:
//   Free listing   $0        no deal creation   —
//   Starter        $49/mo    3 active deals     300 vouchers / month
//   Pro            $99/mo    10 active deals    1,000 vouchers / month
//   Enterprise     $199/mo   unlimited          unlimited

export type TierId = "free" | "starter" | "pro" | "enterprise";

export type Tier = {
  id: TierId;
  name: string;
  /** Price in cents per month. 0 for the free listing. */
  priceCents: number;
  priceLabel: string;
  /** Max deals that may be simultaneously published. 0 = no deal creation. */
  maxActiveDeals: number;
  /** Max vouchers that may be sold per calendar month. Infinity = unlimited. */
  monthlyVoucherPool: number;
  /** Hard ceiling for a single deal's voucher limit (keeps the DB sane). */
  maxVoucherLimitPerDeal: number;
  dealsLabel: string;
  poolLabel: string;
  blurb: string;
  highlights: string[];
  featured?: boolean;
  /**
   * Stripe recurring Price ID for this tier (live mode, created by the owner in
   * the Stripe dashboard). This is the ONLY place prices are mapped to tiers —
   * the checkout code reads it from here. Stripe Price IDs are public
   * identifiers, not secrets, so they are safe in shared/client code.
   * Free is $0 and has no Stripe Price.
   */
  stripePriceId: string | null;
};

export const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free listing",
    priceCents: 0,
    priceLabel: "$0",
    maxActiveDeals: 0,
    monthlyVoucherPool: 0,
    maxVoucherLimitPerDeal: 0,
    dealsLabel: "No deal creation",
    poolLabel: "—",
    blurb: "A directory listing only. Upgrade any time to run voucher deals.",
    highlights: ["Business profile in the directory", "No vouchers", "No monthly fee"],
    stripePriceId: null,
  },
  {
    id: "starter",
    name: "Starter",
    priceCents: 4900,
    priceLabel: "$49",
    maxActiveDeals: 3,
    monthlyVoucherPool: 300,
    maxVoucherLimitPerDeal: 300,
    dealsLabel: "3 active deals",
    poolLabel: "300 vouchers / month",
    blurb: "For one-location shops testing vouchers for the first time.",
    highlights: ["3 active deals", "300 vouchers a month", "Voucher redemption screen"],
    // Starter $49/month recurring — product prod_VVbBU9QmP4Nm1R
    stripePriceId: "price_1UUZysRjf5f49qKtnn6PQzBP",
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 9900,
    priceLabel: "$99",
    maxActiveDeals: 10,
    monthlyVoucherPool: 1000,
    maxVoucherLimitPerDeal: 1000,
    dealsLabel: "10 active deals",
    poolLabel: "1,000 vouchers / month",
    blurb: "The usual fit for a busy restaurant, salon or service business.",
    highlights: ["10 active deals", "1,000 vouchers a month", "Sales dashboard per deal"],
    featured: true,
    // Pro $99/month recurring — product prod_VVbBfbzvkK32gK
    stripePriceId: "price_1UUZysRjf5f49qKtwjZnOEku",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceCents: 19900,
    priceLabel: "$199",
    maxActiveDeals: Number.POSITIVE_INFINITY,
    monthlyVoucherPool: Number.POSITIVE_INFINITY,
    maxVoucherLimitPerDeal: 100_000,
    dealsLabel: "Unlimited active deals",
    poolLabel: "Unlimited vouchers",
    blurb: "Multiple locations, seasonal promotions, unlimited campaigns.",
    highlights: ["Unlimited deals", "Unlimited vouchers", "Priority support"],
    // Enterprise $199/month recurring — product prod_VVbBuljL08dBZK
    stripePriceId: "price_1UUZysRjf5f49qKtWEBgJJKd",
  },
];

/** Stripe Price ID for a tier, or null for the free listing / unknown id. */
export function priceIdForTier(id: string | null | undefined): string | null {
  return tierById(id).stripePriceId;
}

/** The paid tier whose Stripe Price matches, used to map a webhook back to a tier. */
export function tierForPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  return TIERS.find((t) => t.stripePriceId && t.stripePriceId === priceId) ?? null;
}

export const PAID_TIERS = TIERS.filter((t) => t.id !== "free");

export function tierById(id: string | null | undefined): Tier {
  return TIERS.find((t) => t.id === id) ?? TIERS[0];
}

export function isTierId(value: unknown): value is TierId {
  return typeof value === "string" && TIERS.some((t) => t.id === value);
}

/** "Unlimited" for Infinity, otherwise the number with thousands separators. */
export function limitLabel(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "Unlimited";
}

/** "2 of 3" / "2 of Unlimited" */
export function usageLabel(used: number, limit: number): string {
  return `${used} of ${limitLabel(limit)}`;
}
