import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { BillingPanel } from "~/components/billing-panel";
import { Stat, StatusPill, UsageBar, VendorShell } from "~/components/vendor-chrome";
import { categoryName, cityNameFromSlug, formatDate, money } from "~/lib/taxonomy";
import { fetchBillingState } from "~/server/billing-functions";
import { confirmVoucherPaymentManually, fetchVendorDashboard } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/dashboard")({
  head: () => ({
    meta: [{ title: "Vendor dashboard | Shop My Neighborhood" }],
  }),
  loader: async () => {
    const data = await fetchVendorDashboard();
    if (!data) throw redirect({ to: "/vendor/login" });
    // Plan state comes from the vendor row that Stripe's webhook keeps in sync.
    const billing = await fetchBillingState();
    return { ...data, billing };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { me, plan, usage, recent, pending, report, billing, claim } = Route.useLoaderData();
  const router = useRouter();
  const confirmPayment = useServerFn(confirmVoucherPaymentManually);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  async function onConfirm(code: string) {
    setBusyCode(code);
    setNotice(null);
    try {
      const result = await confirmPayment({ data: { code } });
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok) await router.invalidate();
    } catch {
      setNotice({ ok: false, message: "That didn't work — please try again." });
    } finally {
      setBusyCode(null);
    }
  }

  const poolLabel = usage.poolLimit === null ? "unlimited" : usage.poolLimit.toLocaleString("en-US");
  const dealLimitLabel =
    plan.maxActiveDeals === null ? "unlimited" : plan.maxActiveDeals.toLocaleString("en-US");

  return (
    <VendorShell vendorName={me.businessName} tierLabel={plan.name} active="dashboard">
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker">Vendor dashboard</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
              {me.businessName}
            </h1>
            <p className="mt-1 text-[0.82rem] text-ink-soft">
              {cityNameFromSlug(me.citySlug) ?? me.citySlug} · {categoryName(me.categorySlug)} ·{" "}
              {me.email}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/vendor/deals/new"
              className="rounded-full bg-brand px-4 py-2 text-[0.8rem] font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              Create a deal
            </Link>
            <Link
              to="/vendor/redeem"
              className="rounded-full border border-black/15 bg-white px-4 py-2 text-[0.8rem] font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
            >
              Redeem a voucher
            </Link>
          </div>
        </div>

        {billing ? (
          <div className="mt-4">
            <BillingPanel state={billing} />
          </div>
        ) : null}

        <section className="mt-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">Directory listing claim</p>{claim ? <p className="mt-1 text-sm text-ink"><span className="font-semibold capitalize">{claim.status}</span> · {claim.business_name} · {formatDate(claim.created_at)}</p> : <p className="mt-1 text-sm text-ink-soft">No directory listing claim submitted.</p>}</div>
            <Link to={claim?.status === "approved" ? "/vendor/listing" : "/vendor/claim"} className="rounded-full border border-brand/30 px-3.5 py-2 text-xs font-semibold text-brand-dark hover:border-brand">{claim?.status === "approved" ? "Edit listing" : claim ? "View claim" : "Claim a listing"}</Link>
          </div>
        </section>

        {/* PLAN + USAGE */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.68rem] font-semibold tracking-[0.14em] text-ink-soft uppercase">
                  Plan limits
                </p>
                <p className="mt-1 font-display text-2xl font-bold text-brand-dark">{plan.name}</p>
                <p className="text-[0.8rem] text-ink-soft">
                  {plan.priceLabel}
                  {plan.id === "free" ? "" : "/mo"} · subscription status:{" "}
                  <span className="font-semibold text-ink">
                    {billing?.statusLabel ?? me.subscriptionStatus}
                  </span>
                </p>
              </div>
              {billing && !billing.active && (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[0.62rem] font-bold tracking-[0.1em] text-amber-900 uppercase ring-1 ring-amber-300">
                  Deals paused
                </span>
              )}
            </div>

            <dl className="mt-4 grid gap-2 text-[0.82rem]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-soft">Active deals included</dt>
                <dd className="font-semibold text-ink">{plan.dealsLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-ink-soft">Voucher pool</dt>
                <dd className="font-semibold text-ink">{plan.poolLabel}</dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-4 border-t border-black/5 pt-4">
              <div>
                <p className="mb-1.5 text-[0.72rem] font-semibold text-ink">
                  Deal usage — {usage.activeDeals} of {dealLimitLabel} active deals
                </p>
                <UsageBar used={usage.activeDeals} limit={plan.maxActiveDeals} suffix="active deals" />
              </div>
              <div>
                <p className="mb-1.5 text-[0.72rem] font-semibold text-ink">
                  Voucher pool — {usage.vouchersThisMonth} of {poolLabel} sold this month
                </p>
                <UsageBar
                  used={usage.vouchersThisMonth}
                  limit={usage.poolLimit}
                  suffix="vouchers this month"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="Vouchers sold"
              value={report.sold}
              hint="Confirmed by you — counts toward your pool"
              tone="good"
            />
            <Stat
              label="Redeemed"
              value={report.redeemed}
              hint={`${report.outstanding} outstanding`}
            />
            <Stat label="Refunded" value={report.refunded} hint="Within 24 hours, unused only" />
            <Stat
              label="Promo expired"
              value={report.expired}
              hint="Paid value still valid at face value"
              tone={report.expired > 0 ? "warn" : "default"}
            />
            <Stat
              label="Voucher value collected"
              value={money(report.collectedCents)}
              hint="Vendor-reported — you took the money on your own payment page"
              tone="good"
            />
            <Stat
              label="Awaiting payment"
              value={report.pending}
              hint="Started, money not confirmed yet"
              tone={report.pending > 0 ? "warn" : "default"}
            />
          </div>
        </div>

        {/* AWAITING PAYMENT */}
        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-xl font-semibold text-brand-dark">
              Awaiting payment confirmation
            </h2>
            <Link
              to="/vendor/deals"
              className="text-[0.8rem] font-semibold text-brand hover:underline"
            >
              Confirm on a deal page
            </Link>
          </div>
          <p className="mt-1 text-[0.8rem] text-ink-soft">
            Shoppers were sent to your own payment page. When the money lands, confirm it here —
            until then the voucher can&apos;t be redeemed.
          </p>
          {notice && (
            <p
              role="status"
              className={`mt-2 rounded-xl px-3 py-2 text-[0.78rem] font-medium ${
                notice.ok ? "bg-brand-green/15 text-brand-green-dark" : "bg-red-50 text-red-700"
              }`}
            >
              {notice.message}
            </p>
          )}
          {pending.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-5 text-center text-[0.82rem] text-ink-soft">
              Nothing waiting for confirmation right now.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {pending.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[0.8rem] font-semibold text-brand-dark">
                      {v.code}
                    </p>
                    <p className="text-[0.78rem] text-ink">
                      {v.buyer_name} · {v.quantity} voucher{v.quantity === 1 ? "" : "s"} ·{" "}
                      {money(v.amount_cents)}
                    </p>
                    <p className="text-[0.7rem] break-all text-ink-soft">
                      {v.deal_title} · started {formatDate(v.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onConfirm(v.code)}
                    disabled={busyCode === v.code}
                    className="rounded-full bg-brand-green px-4 py-2 text-[0.76rem] font-semibold text-white transition hover:bg-brand-green-dark disabled:opacity-60"
                  >
                    {busyCode === v.code ? "Confirming…" : "Confirm payment received"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* RECENT VOUCHERS */}
        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-xl font-semibold text-brand-dark">Recent vouchers</h2>
            <Link to="/vendor/deals" className="text-[0.8rem] font-semibold text-brand hover:underline">
              All deals and sales
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-black/15 bg-white/60 p-8 text-center">
              <p className="font-display text-lg font-semibold text-ink">No vouchers sold yet</p>
              <p className="mx-auto mt-1 max-w-md text-[0.85rem] text-ink-soft">
                Create a deal and it appears on the public marketplace right away. Vouchers bought
                there show up here.
              </p>
              <Link
                to="/vendor/deals/new"
                className="mt-4 inline-block rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
              >
                Create your first deal
              </Link>
            </div>
          ) : (
            <div className="mt-3 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm">
              <table className="w-full text-left text-[0.82rem]">
                <thead className="bg-cream-deep text-[0.66rem] tracking-[0.12em] text-ink-soft uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Code</th>
                    <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Deal</th>
                    <th className="px-4 py-2.5 font-semibold">Buyer</th>
                    <th className="hidden px-4 py-2.5 font-semibold md:table-cell">Qty</th>
                    <th className="px-4 py-2.5 font-semibold">Amount</th>
                    <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Date</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {recent.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-2.5 font-mono text-[0.78rem] font-semibold text-brand-dark">
                        {v.code}
                      </td>
                      <td className="hidden max-w-[16rem] truncate px-4 py-2.5 text-ink-soft sm:table-cell">
                        {v.deal_title}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="block truncate text-ink">{v.buyer_name}</span>
                        <span className="block truncate text-[0.72rem] text-ink-soft">
                          {v.buyer_email}
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-ink-soft md:table-cell">{v.quantity}</td>
                      <td className="px-4 py-2.5 font-semibold text-ink">{money(v.amount_cents)}</td>
                      <td className="hidden px-4 py-2.5 text-ink-soft sm:table-cell">
                        {formatDate(v.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={v.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {recent.length > 0 && (
            <p className="mt-2 text-[0.72rem] text-ink-soft">
              Amounts are what shoppers paid you on your own payment page — Shop My Neighborhood
              never handles voucher money. Refunds are yours to make through your payment provider.
            </p>
          )}
        </section>
      </div>
    </VendorShell>
  );
}
