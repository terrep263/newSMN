import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { BuyForm } from "~/components/buy-form";
import { TrialBuyPanel } from "~/components/trial-buy-panel";
import { DealCard, DealPlate, SampleBadge, VouchersLeft } from "~/components/deal-card";
import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { isoDayLabel, validDaysLabel } from "~/lib/deal-rules";
import {
  categoryName,
  citySlug,
  daysLeft,
  endLabel,
  formatDate,
  money,
  percentOff,
} from "~/lib/taxonomy";
import { fetchDeal, fetchDeals } from "~/server/functions";

export const Route = createFileRoute("/deals/$slug")({
  loader: async ({ params }) => {
    const deal = await fetchDeal({ data: { slug: params.slug } });
    if (!deal) throw notFound();
    const sameCategory = await fetchDeals({ data: { category: deal.category_slug } });
    return {
      deal,
      related: sameCategory.filter((d) => d.id !== deal.id).slice(0, 3),
    };
  },
  head: ({ loaderData }) => {
    const deal = loaderData?.deal;
    if (!deal) {
      return {
        meta: [{ title: "Deal not found | Shop My Neighborhood" }],
      };
    }
    return {
      meta: [
        { title: `${deal.title} | ${deal.vendor_name}, ${deal.vendor_city}` },
        { name: "description", content: deal.description.slice(0, 158) },
      ],
    };
  },
  component: DealPage,
});

function DealPage() {
  const { deal, related } = Route.useLoaderData();
  const off = percentOff(deal.price_cents, deal.value_cents);
  const saving = deal.value_cents - deal.price_cents;
  const left = Math.max(0, deal.voucher_limit - deal.vouchers_sold);
  const ends = endLabel(deal.ends_at);
  const countdown = daysLeft(deal.ends_at);
  const soldOut = left === 0;

  return (
    <MarketplaceShell city={deal.vendor_city}>
      <div className="mx-auto max-w-6xl px-4 pt-6">
        <nav className="text-[0.72rem] text-ink-soft">
          <Link to="/" className="hover:text-brand">
            Home
          </Link>
          <span className="mx-1.5">/</span>
          <Link to="/deals" className="hover:text-brand">
            Deals
          </Link>
          <span className="mx-1.5">/</span>
          <Link to="/deals" search={{ city: undefined, category: deal.category_slug }} className="hover:text-brand">
            {categoryName(deal.category_slug)}
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">{deal.vendor_city}</span>
        </nav>
      </div>

      <section className="mx-auto max-w-6xl px-4 pt-4 pb-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* LEFT: artwork + story */}
          <div className="min-w-0">
            <DealPlate deal={deal} tall className="overflow-hidden rounded-3xl shadow-sm" />

            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/deals"
                  search={{ category: deal.category_slug }}
                  className="rounded-full bg-brand/10 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-brand-dark hover:bg-brand/15"
                >
                  {categoryName(deal.category_slug)}
                </Link>
                <Link
                  to="/deals"
                  search={{ city: citySlug(deal.vendor_city) }}
                  className="rounded-full bg-cream-deep px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-ink-soft hover:text-brand"
                >
                  {deal.vendor_city}
                </Link>
                {deal.is_sample && <SampleBadge />}
              </div>

              <h1 className="mt-3 font-display text-2xl leading-tight font-semibold text-brand-dark sm:text-3xl">
                {deal.title}
              </h1>
              <p className="mt-2 text-sm text-ink-soft">
                <span className="font-semibold text-ink">{deal.vendor_name}</span> · {deal.vendor_city}, FL
              </p>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">{deal.description}</p>
            </div>

            {/* HIGHLIGHTS */}
            <div className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold text-ink">Highlights</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {deal.highlights.map((h) => (
                  <li key={h} className="flex gap-2 text-sm text-ink-soft">
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-dark" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* WHAT YOU GET */}
            <div className="mt-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold text-ink">What you get</h2>
              <dl className="mt-3 divide-y divide-black/5 text-sm">
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Voucher value</dt>
                  <dd className="text-right font-semibold text-ink">{money(deal.value_cents)}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">You pay</dt>
                  <dd className="text-right font-semibold text-ink">{money(deal.price_cents)}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">You save</dt>
                  <dd className="text-right font-semibold text-brand-green-dark">
                    {money(saving)} ({off}% off)
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Vouchers available</dt>
                  <dd className="text-right font-semibold text-ink">{deal.voucher_limit}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Deal started</dt>
                  <dd className="text-right font-semibold text-ink">{formatDate(deal.starts_at)}</dd>
                </div>
                {ends && (
                  <div className="flex items-start justify-between gap-4 py-2">
                    <dt className="text-ink-soft">Offered until</dt>
                    <dd className="text-right font-semibold text-ink">{formatDate(deal.ends_at)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* THE RULES — everything that limits the voucher, before you buy */}
            <div className="mt-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold text-ink">The rules</h2>
              <p className="mt-1 text-[0.78rem] text-ink-soft">
                Everything that limits this voucher, before you decide.
              </p>
              <dl className="mt-3 divide-y divide-black/5 text-sm">
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Discount</dt>
                  <dd className="text-right font-semibold text-ink">
                    {off}% off — minimum {deal.min_discount_pct}% off
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Limit per customer</dt>
                  <dd className="text-right font-semibold text-ink">
                    {deal.per_customer_limit} voucher{deal.per_customer_limit === 1 ? "" : "s"}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Redeem between</dt>
                  <dd className="text-right font-semibold text-ink">
                    {deal.redemption_start && deal.redemption_end
                      ? `${formatDate(deal.redemption_start)} – ${formatDate(deal.redemption_end)}`
                      : "Not set for this sample deal"}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Days you can use it</dt>
                  <dd className="text-right font-semibold text-ink">{validDaysLabel(deal.valid_days)}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Blackout dates</dt>
                  <dd className="text-right font-semibold text-ink">
                    {deal.blackout_dates.length === 0
                      ? "None"
                      : deal.blackout_dates.map((d) => isoDayLabel(d)).join(", ")}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Paid directly to</dt>
                  <dd className="text-right font-semibold text-ink">{deal.vendor_name}</dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">Refunds</dt>
                  <dd className="text-right font-semibold text-ink">
                    Within 24 hours, unused only
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4 py-2">
                  <dt className="text-ink-soft">After the window</dt>
                  <dd className="text-right font-semibold text-ink">
                    Promo value lapses, paid value never expires
                  </dd>
                </div>
              </dl>

              {deal.redemption_instructions && (
                <div className="mt-3 rounded-xl bg-cream-deep/60 px-3 py-2.5">
                  <p className="text-[0.7rem] font-semibold tracking-[0.12em] uppercase text-ink-soft">
                    How to use it
                  </p>
                  <p className="mt-1 text-[0.82rem] leading-snug text-ink">
                    {deal.redemption_instructions}
                  </p>
                </div>
              )}
            </div>

            {/* FINE PRINT */}
            <div className="mt-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold text-ink">Fine print</h2>
              <ul className="mt-3 space-y-2 text-[0.82rem] leading-relaxed text-ink-soft">
                <li className="flex gap-2">
                  <span className="text-brand-green-dark">•</span>
                  {deal.fine_print}
                </li>
                <li className="flex gap-2">
                  <span className="text-brand-green-dark">•</span>
                  Your voucher code is created when you start the purchase and becomes valid once{" "}
                  {deal.vendor_name} confirms the payment. Show the code on your phone or bring a
                  printed copy.
                </li>
                <li className="flex gap-2">
                  <span className="text-brand-green-dark">•</span>
                  The paid value never expires. The promotional discount expires on{" "}
                  {formatDate(deal.redemption_end) || "the end of the redemption window"}.
                </li>
              </ul>
            </div>

            {/* VENDOR BLOCK */}
            <div className="mt-4 rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <h2 className="font-display text-xl font-semibold text-ink">About the vendor</h2>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand-dark">
                  <Icon name="bag" className="h-5 w-5" />
                </span>
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                    {deal.vendor_name}
                    {deal.is_sample && <SampleBadge />}
                  </p>
                  <p className="text-[0.8rem] text-ink-soft">
                    {deal.vendor_city}, FL · {categoryName(deal.category_slug)}
                  </p>
                </div>
              </div>
              {deal.is_sample && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[0.75rem] leading-snug text-amber-900 ring-1 ring-amber-200">
                  This vendor is fictional sample data used while the marketplace is in preview. No
                  real Lake County business is offering this deal, and the price, value and voucher
                  limit are illustrative only.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT: buy panel */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div
              id="buy"
              className="rounded-3xl border border-black/5 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.05),0_16px_40px_-24px_rgba(16,24,40,0.4)]"
            >
              <div className="flex flex-wrap items-end gap-2">
                <span className="font-display text-4xl leading-none font-bold text-brand-dark">
                  {money(deal.price_cents)}
                </span>
                <span className="pb-1 text-base text-ink-soft line-through">
                  {money(deal.value_cents)}
                </span>
                <span className="mb-1 rounded-md bg-brand-green/15 px-2 py-0.5 text-xs font-bold text-brand-green-dark">
                  {off}% off
                </span>
              </div>
              <p className="mt-1 text-[0.8rem] font-medium text-brand-green-dark">
                You save {money(saving)}
              </p>

              <div className="mt-4">
                <VouchersLeft deal={deal} />
              </div>

              {ends ? (
                <p className="mt-3 flex items-center gap-1.5 text-[0.78rem] font-medium text-ink-soft">
                  <Icon name="clock" className="h-3.5 w-3.5 text-brand" />
                  {ends}
                  {countdown !== null && countdown <= 14 ? ` · ${countdown} day${countdown === 1 ? "" : "s"} left` : ""}
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-1.5 text-[0.78rem] text-ink-soft">
                  <Icon name="clock" className="h-3.5 w-3.5 text-brand" />
                  No end date set for this deal
                </p>
              )}

              <div className="mt-5">
                {soldOut ? (
                  <div className="rounded-2xl bg-ink/5 px-4 py-3 text-center text-sm font-semibold text-ink-soft">
                    Sold out — all {deal.voucher_limit} vouchers have been claimed.
                  </div>
                ) : deal.trial_id != null ? (
                  <TrialBuyPanel
                    slug={deal.slug}
                    priceCents={deal.price_cents}
                    maxQuantity={Math.min(5, left, deal.per_customer_limit)}
                    vendorName={deal.vendor_name}
                  />
                ) : (
                  <BuyForm
                    slug={deal.slug}
                    priceCents={deal.price_cents}
                    maxQuantity={Math.min(5, left)}
                    vendorName={deal.vendor_name}
                    perCustomerLimit={deal.per_customer_limit}
                    hasPaymentLink={Boolean(deal.payment_link_url) && !deal.is_sample}
                  />
                )}
              </div>

              <div className="mt-5 space-y-2 border-t border-black/5 pt-4 text-[0.75rem] text-ink-soft">
                <p className="flex items-start gap-2">
                  <Icon name="ticket" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green-dark" />
                  {deal.trial_id != null
                    ? "Your voucher is valid the moment Stripe confirms your payment."
                    : "Voucher code issued the moment you start, and valid once the vendor confirms your payment."}
                </p>
                <p className="flex items-start gap-2">
                  <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green-dark" />
                  Paid value never expires. The promotional discount ends {formatDate(deal.redemption_end) || "at the end of the redemption window"}.
                </p>
                <p className="flex items-start gap-2">
                  <Icon name="printer" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green-dark" />
                  Printable from your voucher page.
                </p>
              </div>
            </div>

            {deal.is_sample ? (
              <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-[0.72rem] leading-snug text-amber-900">
                <span className="font-bold">Sample deal — demo checkout.</span> This vendor is
                illustrative sample data, so no payment is involved and no card is charged.
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-brand/25 bg-brand/5 px-4 py-3 text-center text-[0.72rem] leading-snug text-brand-dark">
                <span className="font-bold">You pay {deal.vendor_name} directly.</span>{" "}
                {deal.trial_id != null
                  ? "Payment is taken by Stripe on the business's own account. Shop My Neighborhood never takes, holds or refunds voucher money; the business handles refunds."
                  : "Payment happens on their own payment page. Shop My Neighborhood never takes, holds or refunds voucher money."}
              </div>
            )}
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-6">
          <h2 className="font-display text-2xl font-semibold text-brand-dark">
            More in {categoryName(deal.category_slug)}
          </h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((d) => (
              <DealCard key={d.id} deal={d} />
            ))}
          </div>
        </section>
      )}
    </MarketplaceShell>
  );
}
