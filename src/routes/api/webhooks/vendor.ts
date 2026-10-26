// SERVER-ONLY. POST /api/webhooks/vendor — the vendor's way back in.
//
// The handler itself lives in src/server/vendor-webhook.ts so the voucher
// verification script (scripts/verify-voucher-flow.ts) can drive it with a
// constructed Request instead of a running server. Imported dynamically so the
// server-only module never reaches the client bundle.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/webhooks/vendor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleVendorWebhook } = await import("../../../server/vendor-webhook");
        return handleVendorWebhook(request);
      },
    },
  },
});
