// SERVER-ONLY. Vendor subscription billing: plan state, Stripe Checkout,
// the billing portal, and re-reading a subscription from Stripe.
//
// Every function here starts from the logged-in vendor on the server session —
// the browser never supplies a vendor id. `./stripe` and `./vendors` are
// imported dynamically so the Stripe secret key and bun:sqlite stay out of the
// client bundle, the same discipline the rest of the vendor side uses.
//
// HONEST-EMPTY STATE: if STRIPE_SECRET_KEY is not saved in the runtime, every
// call that would touch Stripe returns `billing_not_connected` with the exact
// variable names that are missing, and the dashboard explains that instead of
// pretending an upgrade can be paid for.
import { createServerFn } from "@tanstack/react-start";
import type { Vendor } from "./vendors";

export type PlanOption = {
  id: string;
  name: string;
  priceLabel: string;
  priceId: string | null;
  dealsLabel: string;
  poolLabel: string;
  featured?: boolean;
};

export type BillingState = {
  /** Is a Stripe secret key present in this runtime? */
  configured: boolean;
  /** Env var names still needed before a payment can be taken. */
  missingEnv: string[];
  keyPrefix: string | null;
  liveMode: boolean;
  webhookConfigured: boolean;
  /** Raw Stripe status mirrored on the vendor row. */
  status: string;
  statusLabel: string;
  /** True only when deals may go live. */
  active: boolean;
  tier: string;
  tierName: string;
  priceLabel: string;
  /** ISO date of the end of the paid period, or null. */
  currentPeriodEnd: string | null;
  hasCustomer: boolean;
  hasSubscription: boolean;
  plans: PlanOption[];
};

/**
 * Best-effort public origin for Stripe's return URLs. Resolved on the server
 * only (the request helpers are dynamically imported so they never land in the
 * client bundle): SITE_ORIGIN if set, else the request's own host, else the
 * brand domain.
 */
async function siteOrigin(): Promise<string> {
  const explicit = (process.env.SITE_ORIGIN ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const { getRequestHost, getRequestProtocol } = await import("@tanstack/react-start/server");
    const proto = getRequestProtocol() === "http" ? "http" : "https";
    const host = getRequestHost();
    // The dev/preview proxy masks the host as localhost — never send Stripe back
    // to a loopback address.
    if (host && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return `${proto}://${host}`;
  } catch {
    /* no request context (e.g. a build-time call) — fall through */
  }
  return "https://shopmyneighborhood.com";
}

async function sessionVendor(): Promise<Vendor | null> {
  const auth = await import("./auth");
  return auth.currentVendor();
}

async function buildState(vendor: Vendor): Promise<BillingState> {
  const [{ stripeEnvStatus }, store, tiers] = await Promise.all([
    import("./stripe"),
    import("./vendors"),
    import("../lib/tiers"),
  ]);
  const env = stripeEnvStatus();
  const tier = tiers.tierById(vendor.tier);
  return {
    configured: env.configured,
    missingEnv: env.missing,
    keyPrefix: env.keyPrefix,
    liveMode: env.liveMode,
    webhookConfigured: env.webhookConfigured,
    status: vendor.subscription_status,
    statusLabel: store.subscriptionLabel(vendor.subscription_status),
    active: store.subscriptionIsActive(vendor),
    tier: tier.id,
    tierName: tier.name,
    priceLabel: tier.priceLabel,
    currentPeriodEnd: vendor.current_period_end,
    hasCustomer: !!vendor.stripe_customer_id,
    hasSubscription: !!vendor.stripe_subscription_id,
    plans: tiers.PAID_TIERS.map((t) => ({
      id: t.id,
      name: t.name,
      priceLabel: t.priceLabel,
      priceId: t.stripePriceId,
      dealsLabel: t.dealsLabel,
      poolLabel: t.poolLabel,
      featured: t.featured,
    })),
  };
}

export const fetchBillingState = createServerFn({ method: "GET" }).handler(
  async (): Promise<BillingState | null> => {
    const vendor = await sessionVendor();
    if (!vendor) return null;
    return buildState(vendor);
  },
);

// --------------------------------------------------------------- checkout
export type CheckoutResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: "billing_not_connected" | "unauthenticated" | "invalid_tier" | "stripe"; message: string; missingEnv?: string[] };

/**
 * Starts a Stripe Checkout Session for one paid tier and returns the hosted
 * page URL for the browser to follow. Creating a session moves no money: the
 * customer still has to enter a card on Stripe's own page.
 */
export const startTierCheckout = createServerFn({ method: "POST" })
  .validator((input: { tier: string }) => input)
  .handler(async ({ data }): Promise<CheckoutResult> => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false, error: "unauthenticated", message: "Sign in again to upgrade." };
    const [stripe, tiers] = await Promise.all([import("./stripe"), import("../lib/tiers")]);
    const env = stripe.stripeEnvStatus();
    if (!env.configured) {
      return {
        ok: false,
        error: "billing_not_connected",
        message:
          "Billing isn't connected yet, so no card can be charged. The site owner needs to save the Stripe secret key first.",
        missingEnv: env.missing,
      };
    }
    const tier = tiers.TIERS.find((t) => t.id === data.tier);
    if (!tier || !tier.stripePriceId) {
      return { ok: false, error: "invalid_tier", message: "Choose Starter, Pro or Enterprise." };
    }
    try {
      const session = await stripe.createSubscriptionCheckout({
        priceId: tier.stripePriceId,
        vendorId: vendor.id,
        email: vendor.email,
        origin: await siteOrigin(),
        tier: tier.id,
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL.");
      return { ok: true, url: session.url, sessionId: session.id };
    } catch (err) {
      console.error("[billing] checkout session failed:", (err as Error).message);
      return {
        ok: false,
        error: "stripe",
        message: "Stripe could not start a checkout session. No card was charged — please try again.",
      };
    }
  });

// ------------------------------------------------------------ billing portal
export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; error: string; message: string };

export const openBillingPortal = createServerFn({ method: "POST" }).handler(
  async (): Promise<PortalResult> => {
    const vendor = await sessionVendor();
    if (!vendor) return { ok: false, error: "unauthenticated", message: "Sign in again." };
    const stripe = await import("./stripe");
    const env = stripe.stripeEnvStatus();
    if (!env.configured) {
      return {
        ok: false,
        error: "billing_not_connected",
        message: "Billing isn't connected yet, so there is no billing portal to open.",
      };
    }
    if (!vendor.stripe_customer_id) {
      return { ok: false, error: "no_customer", message: "Choose a plan first — there is no billing account yet." };
    }
    try {
      const session = await stripe.createBillingPortalSession(
        vendor.stripe_customer_id,
        `${await siteOrigin()}/vendor/dashboard`,
      );
      return { ok: true, url: session.url };
    } catch (err) {
      console.error("[billing] portal session failed:", (err as Error).message);
      return { ok: false, error: "stripe", message: "Could not open the billing portal. Try again." };
    }
  },
);

// ---------------------------------------------------------- confirm/refresh
export type ConfirmResult = {
  ok: boolean;
  status: string;
  statusLabel: string;
  tierName: string;
  currentPeriodEnd: string | null;
  message: string;
};

/**
 * Called by /vendor/billing/success. Never trusts the query string on its own:
 * the session id is re-read from Stripe, and it only counts if the session
 * belongs to THIS vendor and Stripe says the subscription is genuinely paid.
 */
export const confirmCheckoutSession = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string }) => input)
  .handler(async ({ data }): Promise<ConfirmResult> => {
    const fail = (message: string): ConfirmResult => ({
      ok: false,
      status: "unconfirmed",
      statusLabel: "Unconfirmed",
      tierName: "",
      currentPeriodEnd: null,
      message,
    });
    const vendor = await sessionVendor();
    if (!vendor) return fail("Sign in to finish setting up your subscription.");
    const sessionId = String(data.sessionId ?? "").trim();
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return fail("That checkout link doesn't look right.");

    const [stripe, store, tiers] = await Promise.all([
      import("./stripe"),
      import("./vendors"),
      import("../lib/tiers"),
    ]);
    if (!stripe.stripeEnvStatus().configured) {
      return fail("Billing isn't connected yet, so this checkout can't be confirmed.");
    }
    try {
      const session = await stripe.retrieveCheckoutSession(sessionId);
      // Ownership: the session must carry this vendor's id in both places we set.
      const owner =
        session.metadata?.vendor_id ?? session.client_reference_id ?? null;
      if (String(owner) !== String(vendor.id)) {
        console.warn("[billing] session/vendor mismatch on success page");
        return fail("That checkout belongs to a different account.");
      }
      if (session.mode !== "subscription") return fail("That checkout was not a subscription.");
      if (session.status !== "complete" || session.payment_status === "unpaid") {
        return fail("Stripe hasn't confirmed the payment yet. Refresh this page in a moment.");
      }

      let subscription = null;
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : (session.subscription as { id?: string } | null)?.id ?? null;
      if (subId) {
        subscription = await stripe.retrieveSubscription(subId);
      }
      const status = subscription?.status ?? "active";
      const priceId = subscription?.items?.data?.[0]?.price?.id ?? null;
      const tierFromPrice = tiers.tierForPriceId(priceId);
      const tierId = tierFromPrice?.id ?? tiers.tierById(session.metadata?.tier ?? vendor.tier).id;

      store.setSubscription(vendor.id, {
        status,
        tier: tierId,
        customerId:
          typeof session.customer === "string"
            ? session.customer
            : (session.customer as { id?: string } | null)?.id ?? null,
        subscriptionId: subId,
        currentPeriodEnd: subscription?.current_period_end ?? null,
      });

      const refreshed = store.getVendorById(vendor.id);
      return {
        ok: store.subscriptionIsActive({ subscription_status: status }),
        status,
        statusLabel: store.subscriptionLabel(status),
        tierName: tiers.tierById(tierId).name,
        currentPeriodEnd: refreshed?.current_period_end ?? null,
        message: store.subscriptionIsActive({ subscription_status: status })
          ? "Your subscription is active."
          : "Stripe reported this subscription as not active yet.",
      };
    } catch (err) {
      console.error("[billing] confirm failed:", (err as Error).message);
      return fail("We couldn't confirm that checkout with Stripe. No charge is hidden — check Manage billing or try again.");
    }
  });

/**
 * "Refresh from Stripe": re-reads the vendor's subscription server-side and
 * mirrors its status locally. This is the recovery path when the webhook is not
 * configured (no STRIPE_WEBHOOK_SECRET) and a status change was missed.
 */
export const refreshSubscriptionFromStripe = createServerFn({ method: "POST" }).handler(
  async (): Promise<ConfirmResult> => {
    const vendor = await sessionVendor();
    if (!vendor) {
      return {
        ok: false,
        status: "unauthenticated",
        statusLabel: "Signed out",
        tierName: "",
        currentPeriodEnd: null,
        message: "Sign in again.",
      };
    }
    const [stripe, store, tiers] = await Promise.all([
      import("./stripe"),
      import("./vendors"),
      import("../lib/tiers"),
    ]);
    if (!stripe.stripeEnvStatus().configured) {
      return {
        ok: false,
        status: vendor.subscription_status,
        statusLabel: store.subscriptionLabel(vendor.subscription_status),
        tierName: tiers.tierById(vendor.tier).name,
        currentPeriodEnd: vendor.current_period_end,
        message: "Billing isn't connected yet, so there is nothing to refresh.",
      };
    }
    if (!vendor.stripe_subscription_id) {
      return {
        ok: false,
        status: vendor.subscription_status,
        statusLabel: store.subscriptionLabel(vendor.subscription_status),
        tierName: tiers.tierById(vendor.tier).name,
        currentPeriodEnd: vendor.current_period_end,
        message: "No Stripe subscription is linked to this account yet.",
      };
    }
    try {
      const subscription = await stripe.retrieveSubscription(vendor.stripe_subscription_id);
      const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
      const tierFromPrice = tiers.tierForPriceId(priceId);
      store.setSubscription(vendor.id, {
        status: subscription.status,
        tier: tierFromPrice?.id,
        customerId:
          typeof subscription.customer === "string" ? subscription.customer : null,
        currentPeriodEnd: subscription.current_period_end ?? null,
      });
      return {
        ok: store.subscriptionIsActive({ subscription_status: subscription.status }),
        status: subscription.status,
        statusLabel: store.subscriptionLabel(subscription.status),
        tierName: tiers.tierById(tierFromPrice?.id ?? vendor.tier).name,
        currentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
        message: "Plan state refreshed from Stripe.",
      };
    } catch (err) {
      console.error("[billing] refresh failed:", (err as Error).message);
      return {
        ok: false,
        status: vendor.subscription_status,
        statusLabel: store.subscriptionLabel(vendor.subscription_status),
        tierName: tiers.tierById(vendor.tier).name,
        currentPeriodEnd: vendor.current_period_end,
        message: "Couldn't reach Stripe just now. Nothing changed on your account.",
      };
    }
  },
);
