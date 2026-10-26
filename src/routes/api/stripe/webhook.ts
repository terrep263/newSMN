// SERVER-ONLY. Stripe webhook endpoint: POST /api/stripe/webhook
//
// Stripe signs every event with the endpoint's signing secret. The raw body is
// verified against STRIPE_WEBHOOK_SECRET before anything is trusted, and a
// request that fails verification changes nothing.
//
// Handled events keep vendors.subscription_status in step with Stripe:
//   checkout.session.completed      first payment succeeded → active
//   customer.subscription.updated   upgrade/downgrade/past_due state changes
//   customer.subscription.deleted   subscription ended → canceled
//   invoice.payment_failed          renewal failed → past_due
//
// With no STRIPE_WEBHOOK_SECRET saved, this route answers 503 and says so in the
// log; the dashboard's "Refresh from Stripe" button is the fallback that pulls
// the same state on demand.
import { createFileRoute } from "@tanstack/react-router";

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = await import("../../../server/stripe");
        const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();

        if (!secret) {
          console.error(
            "[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — cannot verify events. " +
              "Save it in settings (Stripe → Developers → Webhooks → signing secret) to enable live sync.",
          );
          return Response.json(
            { received: false, error: "webhook_not_configured" },
            { status: 503 },
          );
        }

        const rawBody = await request.text();
        const signature = request.headers.get("stripe-signature");
        if (!stripe.verifyWebhookSignature(rawBody, signature, secret)) {
          console.warn("[stripe-webhook] signature verification failed");
          return Response.json({ received: false, error: "bad_signature" }, { status: 400 });
        }

        let event: StripeEvent;
        try {
          event = JSON.parse(rawBody) as StripeEvent;
        } catch {
          return Response.json({ received: false, error: "bad_json" }, { status: 400 });
        }

        const store = await import("../../../server/vendors");
        const tiers = await import("../../../lib/tiers");
        const obj = event.data.object;

        /** Finds the vendor for an event object, preferring our own metadata. */
        const vendorIdFor = (o: Record<string, unknown>): number | null => {
          const meta = (o.metadata ?? {}) as Record<string, string | undefined>;
          const fromMeta = Number(meta.vendor_id);
          if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
          const fromRef = Number(str(o.client_reference_id));
          if (Number.isFinite(fromRef) && fromRef > 0) return fromRef;
          return store.vendorIdForStripeIdentifiers(
            str(o.customer),
            str(o.id) ?? str(o.subscription),
          );
        };

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const vendorId = vendorIdFor(obj);
              if (!vendorId) {
                console.warn("[stripe-webhook] no vendor for checkout session", str(obj.id));
                break;
              }
              const subId = str(obj.subscription);
              let status = "active";
              let periodEnd: number | null = null;
              let tierId: string | null = null;
              if (subId) {
                const sub = await stripe.retrieveSubscription(subId);
                status = sub.status;
                periodEnd = sub.current_period_end ?? null;
                tierId = tiers.tierForPriceId(sub.items?.data?.[0]?.price?.id)?.id ?? null;
              }
              store.setSubscription(vendorId, {
                status,
                tier: tierId ?? undefined,
                customerId: str(obj.customer),
                subscriptionId: subId,
                currentPeriodEnd: periodEnd,
              });
              break;
            }

            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              const status =
                event.type === "customer.subscription.deleted"
                  ? "canceled"
                  : str(obj.status) ?? "incomplete";
              const vendorId = vendorIdFor(obj);
              if (!vendorId) {
                console.warn("[stripe-webhook] no vendor for subscription", str(obj.id));
                break;
              }
              const items = (obj.items ?? {}) as {
                data?: Array<{ price?: { id?: string } }>;
              };
              const tierId = tiers.tierForPriceId(items.data?.[0]?.price?.id)?.id ?? null;
              store.setSubscription(vendorId, {
                status,
                tier: tierId ?? undefined,
                customerId: str(obj.customer),
                subscriptionId: str(obj.id),
                currentPeriodEnd:
                  typeof obj.current_period_end === "number" ? obj.current_period_end : null,
              });
              break;
            }

            case "invoice.payment_failed": {
              const vendorId = store.vendorIdForStripeIdentifiers(
                str(obj.customer),
                str(obj.subscription),
              );
              if (!vendorId) break;
              store.setSubscription(vendorId, { status: "past_due" });
              break;
            }

            default:
              // Everything else is acknowledged so Stripe stops retrying.
              break;
          }
        } catch (err) {
          // 500 so Stripe retries: a transient failure should not lose a status change.
          console.error(`[stripe-webhook] ${event.type} handler failed:`, (err as Error).message);
          return Response.json({ received: false, error: "handler_failed" }, { status: 500 });
        }

        return Response.json({ received: true });
      },
    },
  },
});
