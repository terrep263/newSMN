import { Link, createFileRoute } from "@tanstack/react-router";
import { confirmCheckoutSession } from "~/server/billing-functions";

// Where Stripe sends the browser after a Checkout Session completes.
//
// The ?session_id= in the URL is only a lookup key — it is never trusted on its
// own. The loader hands it to the server, which re-reads the session from
// Stripe, checks it belongs to the logged-in vendor, checks Stripe says the
// subscription is really paid, and only then writes the plan onto the vendor row.
export const Route = createFileRoute("/vendor/billing/success")({
  head: () => ({ meta: [{ title: "Subscription confirmed | Shop My Neighborhood" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    session_id: typeof search.session_id === "string" ? search.session_id : "",
  }),
  loaderDeps: ({ search }) => ({ sessionId: search.session_id }),
  loader: async ({ deps }) => {
    if (!deps.sessionId) {
      return {
        ok: false,
        status: "no_session",
        statusLabel: "No checkout found",
        tierName: "",
        currentPeriodEnd: null as string | null,
        message: "This page is opened after a Stripe checkout. There's no checkout reference in the link.",
      };
    }
    return confirmCheckoutSession({ data: { sessionId: deps.sessionId } });
  },
  component: BillingSuccessPage,
});

function BillingSuccessPage() {
  const result = Route.useLoaderData();
  const renews =
    result.currentPeriodEnd && result.ok
      ? new Date(result.currentPeriodEnd).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-3xl border border-black/5 bg-white p-7 shadow-sm sm:p-9">
        <div
          className={`grid h-12 w-12 place-items-center rounded-2xl text-xl font-bold text-white ${
            result.ok ? "bg-brand-green" : "bg-amber-500"
          }`}
          aria-hidden="true"
        >
          {result.ok ? "✓" : "!"}
        </div>

        <p className="kicker mt-5">Vendor billing</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
          {result.ok ? "Your subscription is active" : "We couldn't confirm that checkout"}
        </h1>
        <p className="mt-3 text-[0.9rem] leading-relaxed text-ink-soft">{result.message}</p>

        <dl className="mt-6 grid gap-2 rounded-2xl bg-cream-deep/60 p-4 text-[0.85rem]">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-soft">Subscription status</dt>
            <dd className="font-semibold text-ink">{result.statusLabel}</dd>
          </div>
          {result.tierName && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-soft">Plan</dt>
              <dd className="font-semibold text-ink">{result.tierName}</dd>
            </div>
          )}
          {renews && (
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-soft">Current period ends</dt>
              <dd className="font-semibold text-ink">{renews}</dd>
            </div>
          )}
        </dl>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            to="/vendor/dashboard"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            Go to your dashboard
          </Link>
          <Link
            to="/vendor/deals/new"
            className="rounded-full border border-brand/30 px-5 py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand"
          >
            Create a deal
          </Link>
        </div>
      </div>
    </div>
  );
}
