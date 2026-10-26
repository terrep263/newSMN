import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { Icon } from "~/components/icons";
import { StatusPill, VendorShell } from "~/components/vendor-chrome";
import { categoryName, formatDate, money } from "~/lib/taxonomy";
import { fetchVendorDeals, setVendorDealStatus } from "~/server/vendor-functions";
import type { VendorDeal } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/deals/")({
  head: () => ({
    meta: [{ title: "My deals | Shop My Neighborhood" }],
  }),
  loader: async () => {
    const data = await fetchVendorDeals();
    if (!data) throw redirect({ to: "/vendor/login" });
    return data;
  },
  component: DealsPage,
});

function StatusButton({ deal }: { deal: VendorDeal }) {
  const router = useRouter();
  const setStatus = useServerFn(setVendorDealStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = deal.status === "published" ? "paused" : "published";

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await setStatus({ data: { id: deal.id, status: next } });
            if (!result.ok) setError(result.error === "not_found" ? "Deal not found." : result.error);
            else await router.invalidate();
          } catch {
            setError("Could not update the deal. Try again.");
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-[0.72rem] font-semibold whitespace-nowrap text-ink-soft transition hover:border-brand hover:text-brand disabled:opacity-60"
      >
        {busy ? "Saving…" : next === "published" ? "Resume" : "Pause"}
      </button>
      {error && <span className="max-w-[14rem] text-[0.68rem] leading-snug text-red-600">{error}</span>}
    </span>
  );
}

function DealsPage() {
  const {
    me,
    deals,
    activeDeals,
    maxActiveDeals,
    tierName,
    canCreateDeals,
    subscriptionActive,
    subscriptionStatusLabel,
    publishBlockedReason,
  } = Route.useLoaderData();
  const limitLabel = maxActiveDeals === null ? "unlimited" : maxActiveDeals;

  return (
    <VendorShell vendorName={me.businessName} tierLabel={tierName} active="deals">
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker">My deals</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
              Your voucher deals
            </h1>
            <p className="mt-1 text-[0.82rem] text-ink-soft">
              {activeDeals} of {limitLabel} active deals on the {tierName} plan. Paused deals keep
              their sales history and don&apos;t count against the limit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreateDeals ? (
              <Link
                to="/vendor/deals/new"
                className="rounded-full bg-brand px-4 py-2 text-[0.8rem] font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                Create a deal
              </Link>
            ) : (
              <span className="rounded-full bg-amber-100 px-4 py-2 text-[0.78rem] font-semibold text-amber-900 ring-1 ring-amber-300">
                Free listing — no deal creation
              </span>
            )}
            <Link
              to="/deals"
              className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.8rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
            >
              Public marketplace
            </Link>
          </div>
        </div>

        {/* Gating reason: why nothing here can go live, and what to do about it */}
        {!subscriptionActive && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.8rem] leading-snug text-amber-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold">
                  Deals are paused — subscription status: {subscriptionStatusLabel}
                </p>
                <p className="mt-1">{publishBlockedReason}</p>
                <p className="mt-1 opacity-90">
                  You can still create and edit deals: they're saved as drafts and stay off the
                  public marketplace until a plan is active.
                </p>
              </div>
              <Link
                to="/vendor/dashboard"
                className="shrink-0 rounded-full bg-brand px-4 py-2 text-[0.78rem] font-semibold text-white transition hover:bg-brand-dark"
              >
                Upgrade
              </Link>
            </div>
          </div>
        )}

        {deals.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-black/15 bg-white/60 p-10 text-center">
            <p className="font-display text-lg font-semibold text-ink">No deals yet</p>
            <p className="mx-auto mt-1 max-w-md text-[0.85rem] text-ink-soft">
              {canCreateDeals
                ? "Create a voucher deal and it will appear in the Lake County marketplace immediately."
                : "Your Free listing plan doesn't include voucher deals. Choose Starter, Pro or Enterprise to start selling."}
            </p>
            {canCreateDeals && (
              <Link
                to="/vendor/deals/new"
                className="mt-4 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
              >
                Create your first deal
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {deals.map((deal) => {
              const pct =
                deal.voucher_limit > 0
                  ? Math.min(100, Math.round((deal.vouchers_sold / deal.voucher_limit) * 100))
                  : 0;
              return (
                <article
                  key={deal.id}
                  className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={deal.status} />
                        <span className="text-[0.68rem] font-semibold tracking-[0.1em] text-ink-soft uppercase">
                          {categoryName(deal.category_slug)} · {deal.vendor_city}
                        </span>
                      </div>
                      <h2 className="mt-1.5 line-clamp-2 font-display text-lg leading-snug font-semibold text-ink">
                        {deal.title}
                      </h2>
                      <p className="mt-1 font-mono text-[0.68rem] break-all text-ink-soft/80">
                        /deals/{deal.slug}
                      </p>
                    </div>
                    <p className="shrink-0 text-right">
                      <span className="block font-display text-xl font-bold text-brand-dark">
                        {money(deal.price_cents)}
                      </span>
                      <span className="block text-[0.72rem] text-ink-soft line-through">
                        {money(deal.value_cents)}
                      </span>
                    </p>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <div className="flex items-baseline justify-between text-[0.72rem] font-medium text-ink-soft">
                        <span>
                          <span className="font-bold text-brand-dark">{deal.vouchers_sold}</span> of{" "}
                          {deal.voucher_limit} sold · {deal.remaining} left
                        </span>
                        <span>{formatDate(deal.starts_at)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10">
                        <div
                          className="h-full rounded-full bg-brand-green"
                          style={{ width: `${Math.max(pct, deal.vouchers_sold > 0 ? 3 : 0)}%` }}
                        />
                      </div>
                      {deal.ends_at && (
                        <p className="mt-1 text-[0.7rem] text-ink-soft">
                          Ends {formatDate(deal.ends_at)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/vendor/deals/$id"
                        params={{ id: String(deal.id) }}
                        className="rounded-full bg-brand px-3.5 py-1.5 text-[0.72rem] font-semibold whitespace-nowrap text-white transition hover:bg-brand-dark"
                      >
                        Sales
                      </Link>
                      <Link
                        to="/vendor/deals/$id/edit"
                        params={{ id: String(deal.id) }}
                        className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-[0.72rem] font-semibold whitespace-nowrap text-ink-soft transition hover:border-brand hover:text-brand"
                      >
                        Edit
                      </Link>
                      <StatusButton deal={deal} />
                      {deal.status === "published" && (
                        <Link
                          to="/deals/$slug"
                          params={{ slug: deal.slug }}
                          className="inline-flex items-center gap-1 rounded-full border border-black/15 bg-white px-3 py-1.5 text-[0.72rem] font-semibold whitespace-nowrap text-ink-soft transition hover:border-brand hover:text-brand"
                        >
                          View
                          <Icon name="arrow" className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </VendorShell>
  );
}
