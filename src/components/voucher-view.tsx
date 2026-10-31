import { Link } from "@tanstack/react-router";

import { SampleBadge } from "~/components/deal-card";
import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { isoDayLabel, validDaysLabel } from "~/lib/deal-rules";
import { SITE, categoryName, formatDate, money } from "~/lib/taxonomy";
import type { PublicVoucherData } from "~/server/functions";
import type { VoucherStatus } from "~/server/repository";

const STATUS_LABEL: Record<VoucherStatus, string> = {
  pending_payment: "Awaiting payment confirmation",
  issued: "Ready to use",
  redeemed: "Redeemed",
  refunded: "Marked refunded",
  expired: "Promotional value expired",
};

const STATUS_CLASS: Record<VoucherStatus, string> = {
  pending_payment: "bg-amber-300 text-amber-950",
  issued: "bg-brand-green text-white",
  redeemed: "bg-white/15 text-white/80",
  refunded: "bg-rose-300 text-rose-950",
  expired: "bg-white/15 text-white/80",
};

function Headline({ status, deal }: { status: VoucherStatus; deal: PublicVoucherData["deal"] }) {
  switch (status) {
    case "pending_payment":
      return (
        <>
          <p className="kicker">Voucher reserved</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            Awaiting confirmation from {deal.vendor_name}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            Your code is reserved, but the payment has not been confirmed yet. The voucher becomes
            valid as soon as the business confirms the money arrived.
          </p>
        </>
      );
    case "issued":
      return (
        <>
          <p className="kicker">Voucher ready</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            Your voucher is ready to use
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            Keep this page, print it, or screenshot the code. The vendor redeems it in person.
          </p>
        </>
      );
    case "redeemed":
      return (
        <>
          <p className="kicker">Voucher used</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            This voucher has been redeemed
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {deal.vendor_name} has already marked this code as used. The date is in the details
            below.
          </p>
        </>
      );
    case "refunded":
      return (
        <>
          <p className="kicker">Voucher refunded</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            Marked refunded by the business
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {deal.vendor_name} returns the money through their own payment provider. Shop My
            Neighborhood never held it, so it can&apos;t reverse the charge itself.
          </p>
        </>
      );
    case "expired":
    default:
      return (
        <>
          <p className="kicker">Promotional value expired</p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            The discount expired — your paid value did not
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            The promotional value lapsed, but the money you paid never expires. {deal.vendor_name}{" "}
            can still take this voucher at face value.
          </p>
        </>
      );
  }
}

export function VoucherView({ data, returning = false }: { data: PublicVoucherData; returning?: boolean }) {
  const { voucher, deal, refund, promoExpired } = data;
  const status = voucher.status;
  const isTrial = deal.trial_id != null;
  const neverPaid = status === "expired" && !voucher.confirmed_at;
  const paidClaim =
    status === "pending_payment"
      ? "Not confirmed yet"
      : voucher.confirmed_via === "demo"
        ? "Demo — no payment taken"
        : `Confirmed${voucher.confirmed_at ? ` ${formatDate(voucher.confirmed_at)}` : ""}`;

  return (
    <MarketplaceShell>
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="no-print text-center">
          {isTrial && status === "pending_payment" ? (
            <>
              <p className="kicker">Payment pending</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
                Waiting for Stripe to confirm your payment
              </h1>
            </>
          ) : neverPaid ? (
            <>
              <p className="kicker">Checkout not completed</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
                This voucher was never paid for
              </h1>
              <p className="mt-2 text-sm text-ink-soft">The checkout timed out and no payment was taken, so this code is not valid.</p>
            </>
          ) : (
            <Headline status={status} deal={deal} />
          )}
        </div>

        {isTrial && status === "pending_payment" && (
          <div className="no-print mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.82rem] leading-snug text-amber-900">
            <p className="font-bold">Your code becomes valid the moment Stripe confirms the payment.</p>
            <p className="mt-1">
              This page checks with Stripe each time you open it. Finished paying? Reload in a few seconds. If you didn&apos;t finish, the reservation is released automatically after 30 minutes and you aren&apos;t charged.
            </p>
          </div>
        )}

        {!isTrial && returning && status === "pending_payment" && (
          <div className="no-print mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.82rem] leading-snug text-amber-900">
            <p className="font-bold">Thanks — you&apos;re back from the payment page.</p>
            <p className="mt-1">
              We don&apos;t assume the payment went through. The business confirms it either
              automatically (via their webhook) or by hand in their dashboard, and this page updates
              as soon as they do. Nothing is charged or held by Shop My Neighborhood.
            </p>
          </div>
        )}

        {!isTrial && status === "pending_payment" && !returning && (
          <div className="no-print mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.82rem] leading-snug text-amber-900">
            <p className="font-bold">Waiting for the business to confirm your payment.</p>
            <p className="mt-1">
              If you haven&apos;t paid yet, finish on {deal.vendor_name}&apos;s payment page. Paid
              already? Give them a few minutes, then reload this page.
            </p>
          </div>
        )}

        {voucher.confirmed_via === "demo" && (
          <div className="no-print mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.8rem] leading-snug text-amber-900">
            <span className="font-bold">Demo voucher — no payment was taken.</span> This is a seeded
            sample deal with no real vendor behind it, so the voucher exists for preview and testing.
          </div>
        )}

        {promoExpired && status !== "redeemed" && status !== "refunded" && (
          <div className="no-print mt-6 rounded-2xl border border-brand/25 bg-brand/5 px-4 py-3 text-[0.82rem] leading-snug text-brand-dark">
            <p className="font-bold">
              Promotional value expired on {isoDayLabel(deal.redemption_end)} — the{" "}
              {money(voucher.amount_cents)} paid is still redeemable at face value.
            </p>
            <p className="mt-1">
              Paid value never expires. {deal.vendor_name} can still redeem this voucher for what you
              paid, even though the extra discount is gone.
            </p>
          </div>
        )}

        <article className="print-card mt-5 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05),0_18px_44px_-28px_rgba(16,24,40,0.45)]">
          <div className="bg-brand-dark px-6 py-6 text-center text-white">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-white/70">
              Voucher code
            </p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-[0.12em] break-all sm:text-4xl">
              {voucher.code}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.14em] ${STATUS_CLASS[status]}`}
              >
                {STATUS_LABEL[status]}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-white/80">
                Qty {voucher.quantity}
              </span>
            </div>
          </div>

          <div className="divide-y divide-black/5">
            <div className="px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-brand-dark">
                  {categoryName(deal.category_slug)}
                </span>
                <span className="rounded-full bg-cream-deep px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-ink-soft">
                  {deal.vendor_city}, FL
                </span>
                {deal.is_sample && <SampleBadge />}
              </div>
              <h2 className="mt-3 font-display text-xl leading-snug font-semibold text-ink">
                {deal.title}
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {deal.vendor_name} · {deal.vendor_city}, FL
              </p>
            </div>

            <dl className="grid gap-x-6 gap-y-3 px-6 py-5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Bought by
                </dt>
                <dd className="mt-0.5 font-medium text-ink">{voucher.buyer_name}</dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Email
                </dt>
                <dd className="mt-0.5 font-medium break-all text-ink">{voucher.buyer_email}</dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Quantity
                </dt>
                <dd className="mt-0.5 font-medium text-ink">{voucher.quantity}</dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Voucher amount
                </dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {money(voucher.amount_cents)}{" "}
                  <span className="text-[0.72rem] font-normal text-ink-soft">
                    ({money(deal.price_cents)} × {voucher.quantity}, paid to {deal.vendor_name})
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Payment
                </dt>
                <dd className="mt-0.5 font-medium text-ink">{paidClaim}</dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Started
                </dt>
                <dd className="mt-0.5 font-medium text-ink">{formatDate(voucher.created_at)}</dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Use between
                </dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {deal.redemption_start && deal.redemption_end
                    ? `${formatDate(deal.redemption_start)} – ${formatDate(deal.redemption_end)}`
                    : "Not set for this sample deal"}
                </dd>
              </div>
              <div>
                <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Valid days
                </dt>
                <dd className="mt-0.5 font-medium text-ink">{validDaysLabel(deal.valid_days)}</dd>
              </div>
              {voucher.redeemed_at && (
                <div>
                  <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                    Redeemed
                  </dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {formatDate(voucher.redeemed_at)}
                    {voucher.paid_value_only === 1 ? " · paid value only" : ""}
                  </dd>
                </div>
              )}
              {voucher.refunded_at && (
                <div>
                  <dt className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                    Refunded
                  </dt>
                  <dd className="mt-0.5 font-medium text-ink">{formatDate(voucher.refunded_at)}</dd>
                </div>
              )}
            </dl>

            <div className="px-6 py-5">
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                How to redeem
              </h3>
              <p className="mt-2 text-sm text-ink-soft">
                {deal.redemption_instructions ??
                  "Tell the vendor you have a Shop My Neighborhood voucher, show them the code above, and they mark it redeemed."}
              </p>
              <p className="mt-3 text-[0.72rem] leading-relaxed text-ink-soft">{deal.fine_print}</p>
            </div>

            <div className="px-6 py-5">
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Refunds
              </h3>
              <p
                className={`mt-2 text-[0.82rem] leading-snug ${refund.allowed ? "text-ink" : "text-ink-soft"}`}
              >
                {refund.reason}
              </p>
              <p className="mt-1 text-[0.72rem] leading-relaxed text-ink-soft">
                {isTrial
                  ? `Refunds are handled by ${deal.vendor_name} through their own Stripe account — Shop My Neighborhood never takes, holds or refunds voucher money.`
                  : `Refunds are handled by ${deal.vendor_name} through their own payment provider — Shop My Neighborhood never takes, holds or refunds voucher money. The 24-hour window is counted from when the voucher code was created.`}
              </p>
            </div>
          </div>
        </article>

        <div className="no-print mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <Icon name="printer" className="h-4 w-4" />
            Print this voucher
          </button>
          <Link
            to="/deals/$slug"
            params={{ slug: deal.slug }}
            className="rounded-full border border-brand/30 px-5 py-2.5 text-sm font-semibold text-brand-dark hover:border-brand"
          >
            Back to the deal
          </Link>
          <Link
            to="/deals"
            className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-semibold text-ink-soft hover:border-brand/40 hover:text-brand"
          >
            Browse more deals
          </Link>
        </div>

        <p className="no-print mt-6 text-center text-[0.72rem] text-ink-soft">
          Questions about a voucher? Email{" "}
          <a className="underline hover:text-brand" href={`mailto:${SITE.email}`}>
            {SITE.email}
          </a>{" "}
          or call{" "}
          <a className="underline hover:text-brand" href={SITE.phoneHref}>
            {SITE.phone}
          </a>
          .
        </p>
      </div>
    </MarketplaceShell>
  );
}
