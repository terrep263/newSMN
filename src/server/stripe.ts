// SERVER-ONLY. Minimal Stripe client for vendor subscriptions.
//
// Why not the `stripe` npm package: this app runs on Bun with `bun:sqlite` and
// no other runtime dependency, and every call we need is a single REST request.
// Talking to https://api.stripe.com directly keeps the bundle small, keeps the
// secret key out of the client graph, and makes the whole surface auditable in
// one file. Webhook signatures are verified with node:crypto.
//
// IMPORTANT — import discipline: this module reads process.env.STRIPE_SECRET_KEY
// and must never reach the browser bundle. Server code imports it dynamically
// (`await import("./stripe")`) exactly like it does for ./vendors, so Vite can
// keep it out of the client build.
//
// Nothing here can charge a card on its own: it only creates Checkout Sessions
// (which redirect the customer to Stripe's own hosted page) and reads state
// back. No key ever leaves the server; only IDs and URLs are returned.
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const API_BASE = "https://api.stripe.com/v1";

/** Thrown when a billing call is attempted with no key configured. */
export class BillingNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Stripe billing is not connected (missing: ${missing.join(", ")})`);
    this.name = "BillingNotConfiguredError";
  }
}

/**
 * The webhook signing secret: STRIPE_WEBHOOK_SECRET when set, otherwise the file
 * scripts/stripe-setup.ts saved next to the database (so the secret never has to
 * be pasted anywhere).
 */
export function webhookSecret(): string {
  const fromEnv = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (fromEnv) return fromEnv;
  const dbPath = process.env.MARKETPLACE_DB_PATH ?? "";
  if (!dbPath) return "";
  const file = join(dirname(dbPath), "stripe-webhook-secret");
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  } catch {
    return "";
  }
}

export type StripeEnvStatus = {
  /** true only when a secret key is present in this runtime. */
  configured: boolean;
  /** Secret-key prefix we recognise — never the key itself. */
  keyPrefix: string | null;
  liveMode: boolean;
  /** true when STRIPE_WEBHOOK_SECRET is present, so /api/stripe/webhook can verify. */
  webhookConfigured: boolean;
  /** Environment variable names that must be saved for billing to work. */
  missing: string[];
};

/**
 * Reports *whether* billing is wired up in this runtime without ever exposing a
 * secret value. The dashboard uses this to explain honestly why the Upgrade
 * button cannot take a payment yet.
 */
export function stripeEnvStatus(): StripeEnvStatus {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  const webhook = webhookSecret();
  const known = ["sk_live_", "sk_test_", "rk_live_", "rk_test_"] as const;
  const found = key ? known.find((p) => key.startsWith(p)) : undefined;
  const missing: string[] = [];
  if (!key) missing.push("STRIPE_SECRET_KEY");
  if (!webhook) missing.push("STRIPE_WEBHOOK_SECRET");
  return {
    configured: key.length > 0,
    keyPrefix: found ? key.slice(0, 7) : key ? "unknown" : null,
    liveMode: !!found && found.startsWith("rk_live_") === false && found.startsWith("sk_live_"),
    webhookConfigured: webhook.length > 0,
    missing,
  };
}

function secretKey(): string {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new BillingNotConfiguredError(stripeEnvStatus().missing);
  return key;
}

/**
 * One REST call to Stripe. `form` keys are sent exactly as given, so nested
 * params use Stripe's bracket notation (`metadata[vendor_id]`, `line_items[0][price]`).
 * Throws an Error carrying Stripe's own message on a non-2xx response.
 */
type StripeCallOptions = {
  /** Acts on this connected account (direct charges): sent as the Stripe-Account header. */
  account?: string;
  /** Makes a retried POST safe: Stripe returns the first result instead of repeating it. */
  idempotencyKey?: string;
};

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  form?: Record<string, string | number | undefined | null>,
  options: StripeCallOptions = {},
): Promise<T> {
  const key = secretKey();
  const url = new URL(API_BASE + path);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
    // Pin the API version so a Stripe-side default change can't alter shapes.
    "Stripe-Version": "2024-06-20",
  };
  if (options.account) headers["Stripe-Account"] = options.account;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const init: RequestInit = { method, headers };
  if (form && method === "GET") {
    for (const [k, v] of Object.entries(form)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  } else if (form) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (v !== undefined && v !== null) body.set(k, String(v));
    }
    init.body = body;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page — fall through to the status check */
  }
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      `Stripe request failed (${res.status})`;
    throw new Error(message);
  }
  return json as T;
}

// ------------------------------------------------------------------ shapes
/** The subset of Stripe's objects this app reads. */
export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ price?: { id?: string } }> };
};
export type StripeCheckoutSession = {
  id: string;
  object: "checkout.session";
  mode: string | null;
  status: string | null;
  payment_status: string | null;
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  amount_total: number | null;
  currency: string | null;
  metadata?: Record<string, string> | null;
  url?: string | null;
};

// --------------------------------------------------------------- checkout
export type CreateCheckoutInput = {
  priceId: string;
  vendorId: number;
  email: string;
  origin: string;
  tier: string;
};

/**
 * Creates a subscription-mode Checkout Session on Stripe. The customer is sent
 * to Stripe's hosted page; the vendor id travels in both client_reference_id
 * and metadata, so the success page and the webhook can both prove who paid.
 */
export async function createSubscriptionCheckout(
  input: CreateCheckoutInput,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>("POST", "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": 1,
    customer_email: input.email,
    client_reference_id: String(input.vendorId),
    "metadata[vendor_id]": String(input.vendorId),
    "metadata[tier]": input.tier,
    // Copied onto the Subscription too, so webhooks that carry only a
    // subscription (no session) can still be traced back to the vendor.
    "subscription_data[metadata][vendor_id]": String(input.vendorId),
    "subscription_data[metadata][tier]": input.tier,
    allow_promotion_codes: "true",
    success_url: `${input.origin}/vendor/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/vendor/dashboard?checkout=cancelled`,
  });
}

export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(
    "GET",
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { "expand[]": "subscription" },
  );
}

/** Expires an open session so an abandoned test checkout can't be paid later. */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  await stripeRequest("POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`);
}

export async function retrieveSubscription(id: string): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(id)}`);
}

/** Stripe-hosted billing portal (change card, invoices, cancel). */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<{ id: string; url: string }> {
  return stripeRequest<{ id: string; url: string }>("POST", "/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
}

// -------------------------------------------------------------- webhooks
/**
 * Verifies a `Stripe-Signature` header against the raw request body using the
 * documented `t=<timestamp>,v1=<hex hmac>` scheme. Returns false (never throws)
 * on any mismatch, so the route can answer 400 without leaking why.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !secret) return false;
  let timestamp: string | null = null;
  const v1: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t") timestamp = v;
    else if (k === "v1" && v) v1.push(v);
  }
  if (!timestamp || v1.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject replays of an old signature (Stripe's own recommendation).
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  for (const candidate of v1) {
    const candidateBuf = Buffer.from(candidate, "hex");
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}


// ------------------------------------------------- connected accounts (trial)
//
// Free-trial vendors take payment on their OWN Stripe account (Connect
// "Standard"). Every charge is a direct charge on that account: no
// application_fee_amount is ever set, the platform never holds the funds, and
// the vendor alone handles refunds, disputes and payouts.

/** Secret for the Connect webhook endpoint (/api/stripe/connect-webhook). */
export function connectWebhookSecret(): string {
  const fromEnv = (process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "").trim();
  if (fromEnv) return fromEnv;
  const dbPath = process.env.MARKETPLACE_DB_PATH ?? "";
  if (!dbPath) return "";
  const file = join(dirname(dbPath), "stripe-connect-webhook-secret");
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  } catch {
    return "";
  }
}

export type StripeConnectedAccount = {
  id: string;
  type?: string;
  charges_enabled: boolean;
  details_submitted: boolean;
  payouts_enabled?: boolean;
};

export async function createConnectedAccount(input: {
  vendorId: number;
  email: string;
  businessName: string;
}): Promise<StripeConnectedAccount> {
  return stripeRequest<StripeConnectedAccount>(
    "POST",
    "/accounts",
    {
      type: "standard",
      country: "US",
      email: input.email,
      "business_profile[name]": input.businessName,
      "metadata[vendor_id]": String(input.vendorId),
    },
    { idempotencyKey: `smn-connect-account-vendor-${input.vendorId}` },
  );
}

export async function createAccountOnboardingLink(input: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<{ url: string; expires_at: number }> {
  return stripeRequest<{ url: string; expires_at: number }>("POST", "/account_links", {
    account: input.accountId,
    type: "account_onboarding",
    return_url: input.returnUrl,
    refresh_url: input.refreshUrl,
  });
}

export async function retrieveConnectedAccount(accountId: string): Promise<StripeConnectedAccount> {
  return stripeRequest<StripeConnectedAccount>("GET", `/accounts/${encodeURIComponent(accountId)}`);
}

export type StripeConnectSession = StripeCheckoutSession & {
  payment_intent?: string | null;
  expires_at?: number;
};

/**
 * Direct-charge Checkout Session on the vendor's own account. Deliberately has
 * no application_fee_amount: the platform takes nothing.
 */
export async function createVendorCheckoutSession(input: {
  accountId: string;
  voucherCode: string;
  dealTitle: string;
  vendorName: string;
  unitAmountCents: number;
  quantity: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  holdMinutes: number;
}): Promise<StripeConnectSession> {
  const expiresAt = Math.floor(Date.now() / 1000) + input.holdMinutes * 60;
  return stripeRequest<StripeConnectSession>(
    "POST",
    "/checkout/sessions",
    {
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": input.unitAmountCents,
      "line_items[0][price_data][product_data][name]": `${input.dealTitle} — ${input.vendorName}`.slice(0, 250),
      "line_items[0][quantity]": input.quantity,
      customer_email: input.customerEmail,
      client_reference_id: input.voucherCode,
      "metadata[voucher_code]": input.voucherCode,
      "payment_intent_data[metadata][voucher_code]": input.voucherCode,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: expiresAt,
    },
    { account: input.accountId, idempotencyKey: `smn-voucher-checkout-${input.voucherCode}` },
  );
}

export async function retrieveVendorCheckoutSession(
  accountId: string,
  sessionId: string,
): Promise<StripeConnectSession> {
  return stripeRequest<StripeConnectSession>(
    "GET",
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    undefined,
    { account: accountId },
  );
}

export async function expireVendorCheckoutSession(accountId: string, sessionId: string): Promise<void> {
  await stripeRequest("POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, undefined, {
    account: accountId,
  });
}
