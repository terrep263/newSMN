import { Link, createFileRoute } from "@tanstack/react-router";

import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { SITE } from "~/lib/taxonomy";
import { TIERS, limitLabel } from "~/lib/tiers";
import { fetchVendorMe } from "~/server/vendor-functions";

export const Route = createFileRoute("/vendor/")({
  head: () => ({
    meta: [
      { title: "For Vendors — run voucher deals in Lake County | Shop My Neighborhood" },
      {
        name: "description",
        content:
          "Vendors keep 100% of voucher revenue. Flat monthly plans from $49/mo: 3 to unlimited deals and up to unlimited vouchers. Run your own deals for Lake County shoppers.",
      },
    ],
  }),
  loader: () => fetchVendorMe(),
  component: ForVendors,
});

const STEPS = [
  {
    title: "Create your vendor account",
    body: "Tell us your business name, city and category, then pick the plan that fits. No card is taken while billing is being connected.",
    icon: "check" as const,
  },
  {
    title: "Build a voucher deal",
    body: "Set the price, the value, what's included and how many vouchers you'll accept. Your plan caps how many deals run at once.",
    icon: "ticket" as const,
  },
  {
    title: "Shoppers buy your deal",
    body: "Your deal appears in the Lake County marketplace next to every other local offer, browsable by city and category.",
    icon: "search" as const,
  },
  {
    title: "Redeem the code in store",
    body: "The customer shows their voucher code on a phone or printout. Type it in, confirm, done — one field, a few seconds.",
    icon: "printer" as const,
  },
];

function ForVendors() {
  const me = Route.useLoaderData();

  return (
    <MarketplaceShell vendorName={me?.businessName}>
      {/* HERO */}
      <section className="relative overflow-hidden bg-brand-dark">
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, #5DB85F 0%, transparent 45%), radial-gradient(circle at 85% 10%, #4A6FA5 0%, transparent 55%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-18">
          <p className="kicker text-brand-green">For Lake County businesses</p>
          <h1 className="mt-2 max-w-3xl font-display text-3xl leading-tight font-bold text-white sm:text-4xl">
            Run your own voucher deals. Keep 100% of the voucher revenue.
          </h1>
          <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-white/85">
            {SITE.name} is a local marketplace for {SITE.county}. You pay a flat monthly
            subscription and nothing else — no commission, no per-voucher fee, no cut of what your
            customers spend.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/vendor/signup"
              className="rounded-full bg-brand-green px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-green-dark"
            >
              Create your vendor account
            </Link>
            <Link
              to="/vendor/login"
              className="rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
          {me && (
            <p className="mt-4 text-[0.8rem] text-white/75">
              You&apos;re already signed in as {me.businessName}.{" "}
              <Link to="/vendor/dashboard" className="font-semibold text-white underline">
                Go to your dashboard
              </Link>
              .
            </p>
          )}
        </div>
      </section>

      {/* NO COMMISSION */}
      <section className="mx-auto max-w-6xl px-4 pt-8">
        <div className="grid gap-3 rounded-3xl border border-brand-green/30 bg-white p-5 shadow-sm sm:grid-cols-3">
          <div className="sm:col-span-3">
            <p className="flex items-center gap-2 font-display text-xl font-semibold text-brand-dark">
              <Icon name="check" className="h-5 w-5 text-brand-green-dark" />
              Keep 100% of voucher revenue — we take no commission.
            </p>
          </div>
          <p className="text-[0.85rem] leading-relaxed text-ink-soft">
            When a shopper buys your voucher, the money is yours. We never take a percentage of a
            sale and we never mark up your offer.
          </p>
          <p className="text-[0.85rem] leading-relaxed text-ink-soft">
            Your only cost is the flat monthly plan you pick below. Cancel or change it whenever you
            like.
          </p>
          <p className="text-[0.85rem] leading-relaxed text-ink-soft">
            You run your own deal: price, value, terms and voucher limit are all yours to set, inside
            your plan&apos;s limits.
          </p>
        </div>
      </section>

      {/* TIERS */}
      <section id="plans" className="mx-auto max-w-6xl px-4 pt-12">
        <h2 className="font-display text-2xl font-semibold text-brand-dark sm:text-3xl">Plans</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Every plan includes the vendor dashboard, per-deal sales figures and the in-store
          redemption screen. The free listing puts your business in the directory only.
        </p>

        {/* Desktop table — the plan table exactly as published */}
        <div className="mt-6 hidden overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-cream-deep text-[0.7rem] tracking-[0.14em] text-ink-soft uppercase">
              <tr>
                <th className="px-5 py-3 font-semibold">Plan</th>
                <th className="px-5 py-3 font-semibold">Price</th>
                <th className="px-5 py-3 font-semibold">Active deals</th>
                <th className="px-5 py-3 font-semibold">Voucher pool</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {TIERS.map((tier) => (
                <tr key={tier.id} className={tier.featured ? "bg-brand-green/5" : undefined}>
                  <td className="px-5 py-4">
                    <span className="font-semibold text-ink">{tier.name}</span>
                    {tier.featured && (
                      <span className="ml-2 rounded-full bg-brand-green/20 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.1em] text-brand-green-dark">
                        Most popular
                      </span>
                    )}
                    <p className="mt-1 max-w-xs text-[0.75rem] leading-snug text-ink-soft">
                      {tier.blurb}
                    </p>
                  </td>
                  <td className="px-5 py-4 font-semibold text-brand-dark">
                    {tier.id === "free" ? "$0" : `${tier.priceLabel}/mo`}
                  </td>
                  <td className="px-5 py-4 text-ink-soft">{tier.dealsLabel}</td>
                  <td className="px-5 py-4 text-ink-soft">{tier.poolLabel}</td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      to="/vendor/signup"
                      className="rounded-full bg-brand px-4 py-2 text-[0.78rem] font-semibold whitespace-nowrap text-white transition hover:bg-brand-dark"
                    >
                      {tier.id === "free" ? "List for free" : `Choose ${tier.name}`}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="mt-6 grid gap-4 md:hidden">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`rounded-3xl border bg-white p-5 shadow-sm ${
                tier.featured ? "border-brand-green/40" : "border-black/5"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-display text-xl font-semibold text-brand-dark">{tier.name}</h3>
                <span className="font-display text-xl font-bold text-brand-dark">
                  {tier.id === "free" ? "$0" : `${tier.priceLabel}/mo`}
                </span>
              </div>
              <p className="mt-1 text-[0.82rem] text-ink-soft">{tier.blurb}</p>
              <dl className="mt-3 grid gap-1.5 text-[0.82rem]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Active deals</dt>
                  <dd className="font-semibold text-ink">{limitLabel(tier.maxActiveDeals)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-soft">Voucher pool</dt>
                  <dd className="font-semibold text-ink">
                    {Number.isFinite(tier.monthlyVoucherPool)
                      ? `${limitLabel(tier.monthlyVoucherPool)} / month`
                      : "Unlimited"}
                  </dd>
                </div>
              </dl>
              <Link
                to="/vendor/signup"
                className="mt-4 block rounded-full bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-brand-dark"
              >
                {tier.id === "free" ? "List for free" : `Choose ${tier.name}`}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[0.78rem] leading-snug text-amber-900">
          <span className="font-bold">Billing isn&apos;t live yet.</span> Choosing a plan records the
          plan you want and starts your account immediately — no card is asked for and nothing is
          charged until payment processing is connected.
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-4 pt-14">
        <h2 className="font-display text-2xl font-semibold text-brand-dark sm:text-3xl">
          How it works
        </h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-3xl border border-black/5 bg-white p-5 shadow-sm">
              <span className="grid h-9 w-9 place-items-center rounded-2xl bg-brand/10 font-display text-sm font-bold text-brand-dark">
                {i + 1}
              </span>
              <h3 className="mt-3 font-display text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-1.5 text-[0.82rem] leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* WHAT YOU GET */}
      <section className="mx-auto max-w-6xl px-4 pt-12">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <h2 className="font-display text-xl font-semibold text-brand-dark">
              What&apos;s in the vendor dashboard
            </h2>
            <ul className="mt-3 grid gap-2 text-[0.85rem] text-ink-soft">
              {[
                "Your plan and exactly how much of it you're using",
                "Active deal count and monthly voucher pool usage",
                "Vouchers sold per deal, with buyer name, email and quantity",
                "Pause and resume a deal without deleting it",
                "One-field voucher redemption for the counter or the shop floor",
              ].map((line) => (
                <li key={line} className="flex gap-2">
                  <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-dark" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-black/5 bg-brand-dark p-6 text-white shadow-sm">
            <h2 className="font-display text-xl font-semibold">Not sure which plan?</h2>
            <p className="mt-2 text-[0.85rem] leading-relaxed text-white/85">
              Start with Starter if you want to test one offer, Pro if you run several promotions a
              year, and Enterprise if you have more than one location or a permanent menu of deals.
              You can change plans later without losing your deals.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to="/vendor/signup"
                className="rounded-full bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-green-dark"
              >
                Sign up
              </Link>
              <Link
                to="/vendor/login"
                className="rounded-full border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Log in
              </Link>
            </div>
            <p className="mt-5 text-[0.75rem] text-white/70">
              Questions? Email{" "}
              <a className="underline" href={`mailto:${SITE.email}`}>
                {SITE.email}
              </a>{" "}
              or call {SITE.phone}.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-12">
        <div className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-black/5">
          <h2 className="font-display text-2xl font-semibold text-brand-dark">
            Ready to run your first Lake County deal?
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
            Create your account, pick a plan and publish a voucher deal in a few minutes. No card is
            charged while billing is being connected.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link
              to="/vendor/signup"
              className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              Create your vendor account
            </Link>
            <Link
              to="/deals"
              className="rounded-full border border-black/15 px-6 py-3 text-sm font-semibold text-ink-soft transition hover:border-brand hover:text-brand"
            >
              Browse the marketplace
            </Link>
          </div>
        </div>
      </section>
    </MarketplaceShell>
  );
}
