// SERVER-ONLY. Stripe Connect webhook endpoint: POST /api/stripe/connect-webhook
//
// Receives events from trial vendors' own connected accounts (the endpoint is
// configured in Stripe with "Listen to events on Connected accounts"). Each event
// is verified against STRIPE_CONNECT_WEBHOOK_SECRET before anything is trusted.
//   checkout.session.completed / async_payment_succeeded  → voucher becomes valid
//   checkout.session.expired                              → unpaid reservation released
//   account.updated                                       → charges_enabled mirrored; approved deal goes live
//   charge.refunded                                       → refund recorded on the voucher
import { createFileRoute } from "@tanstack/react-router";

type ConnectEvent = {
  id: string;
  type: string;
  account?: string;
  data: { object: Record<string, any> };
};

export const Route = createFileRoute("/api/stripe/connect-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const stripe = await import("../../../server/stripe");
        const secret = stripe.connectWebhookSecret();
        if (!secret) {
          console.error("[connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not set — cannot verify events.");
          return Response.json({ received: false, error: "webhook_not_configured" }, { status: 503 });
        }
        const rawBody = await request.text();
        if (!stripe.verifyWebhookSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
          console.warn("[connect-webhook] signature verification failed");
          return Response.json({ received: false, error: "bad_signature" }, { status: 400 });
        }
        let event: ConnectEvent;
        try {
          event = JSON.parse(rawBody) as ConnectEvent;
        } catch {
          return Response.json({ received: false, error: "bad_json" }, { status: 400 });
        }
        const accountId = event.account ?? "";
        const obj = event.data.object;
        const ts = await import("../../../server/trial-stripe");
        const trials = await import("../../../server/trials");
        try {
          switch (event.type) {
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded": {
              const res = ts.applyPaidSession(obj as any, accountId);
              if (!res.ok) console.warn(`[connect-webhook] ${event.type} not applied: ${res.reason}`);
              break;
            }
            case "checkout.session.expired": {
              const code = String(obj.metadata?.voucher_code ?? obj.client_reference_id ?? "").toUpperCase();
              if (code) trials.releaseUnpaidTrialVoucher(code, "checkout expired");
              break;
            }
            case "account.updated":
              ts.applyAccountState({
                id: String(obj.id),
                charges_enabled: !!obj.charges_enabled,
                details_submitted: !!obj.details_submitted,
              });
              break;
            case "charge.refunded":
              ts.applyChargeRefunded(obj as any, accountId);
              break;
            default:
              break;
          }
        } catch (e) {
          console.error(`[connect-webhook] ${event.type} failed:`, (e as Error).message);
          return Response.json({ received: false, error: "handler_failed" }, { status: 500 });
        }
        return Response.json({ received: true });
      },
    },
  },
});
