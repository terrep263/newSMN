import { Link, createFileRoute } from "@tanstack/react-router";
import { getRouteApi } from "@tanstack/react-router";

import { DealCard } from "~/components/deal-card";
import { CategoryIcon, Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { CATEGORIES, CITIES, DIRECTORY_CATEGORIES, SITE } from "~/lib/taxonomy";
import { fetchHomeData } from "~/server/functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shop My Neighborhood | Lake County FL Deals & Local Vouchers" },
      {
        name: "description",
        content:
          "Browse local deal vouchers from Lake County, Florida businesses in Clermont, Leesburg, Mount Dora, Tavares and 13 more cities. Vendors keep 100% of voucher revenue.",
      },
    ],
  }),
  loader: () => fetchHomeData(),
  component: Home,
});

const routeApi = getRouteApi("/");

function Home() {
  const { featured, totalDeals } = routeApi.useLoaderData();

  return (
    <MarketplaceShell>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/hero-downtown.jpg)" }}
          aria-hidden
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-brand-dark/85 via-brand-dark/60 to-brand-dark/80"
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <p className="text-center font-display text-3xl leading-tight font-bold text-white drop-shadow-sm sm:text-5xl">
            Support Local. Shop Your Neighborhood.
          </p>

          <div className="mx-auto mt-8 max-w-2xl rounded-3xl bg-white/95 p-5 shadow-xl ring-1 ring-black/5 backdrop-blur sm:p-7">
            <h1 className="font-display text-2xl leading-snug font-semibold text-brand-dark sm:text-3xl">
              Shop local businesses and deals in Lake County, Florida
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Discover vouchers from local restaurants, shops and services — plus a free directory of
              businesses in all 17 Lake County communities.
            </p>

            <form action="/businesses" method="get" className="mt-5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="relative block">
                <span className="sr-only">City</span>
                <Icon name="pin" className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-brand" />
                <select
                  name="city"
                  defaultValue=""
                  className="w-full appearance-none rounded-full border border-black/10 bg-white py-2.5 pr-8 pl-9 text-sm font-medium text-ink shadow-sm focus:ring-2 focus:ring-brand/30 focus:outline-none"
                >
                  <option value="">All Lake County cities</option>
                  {CITIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute top-2.5 right-3 text-xs text-ink-soft">▾</span>
              </label>

              <label className="relative block">
                <span className="sr-only">Category</span>
                <Icon name="ticket" className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-brand" />
                <select
                  name="category"
                  defaultValue=""
                  className="w-full appearance-none rounded-full border border-black/10 bg-white py-2.5 pr-8 pl-9 text-sm font-medium text-ink shadow-sm focus:ring-2 focus:ring-brand/30 focus:outline-none"
                >
                  <option value="">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute top-2.5 right-3 text-xs text-ink-soft">▾</span>
              </label>

              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                <Icon name="search" className="h-4 w-4" />
                Search
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-2">
              {["restaurants-cafes", "bars-nightlife", "spas-massage-wellness", "local-retail-boutiques", "fitness-personal-training"].map(
                (slug) => {
                  const c = CATEGORIES.find((x) => x.slug === slug)!;
                  return (
                    <Link
                      key={slug}
                      to="/businesses"
                      search={{ category: slug }}
                      className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[0.75rem] font-medium text-ink-soft hover:border-brand/40 hover:text-brand"
                    >
                      {c.short}
                    </Link>
                  );
                },
              )}
            </div>
          </div>

          <div className="mx-auto mt-8 grid max-w-2xl grid-cols-3 gap-3 text-center text-white">
            <div className="rounded-2xl bg-white/10 px-2 py-3 ring-1 ring-white/20 backdrop-blur">
              <p className="font-display text-xl font-bold">{CITIES.length}</p>
              <p className="text-[0.66rem] uppercase tracking-[0.14em] text-white/80">Cities</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-2 py-3 ring-1 ring-white/20 backdrop-blur">
              <p className="font-display text-xl font-bold">{CATEGORIES.length}</p>
              <p className="text-[0.66rem] uppercase tracking-[0.14em] text-white/80">Categories</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-2 py-3 ring-1 ring-white/20 backdrop-blur">
              <p className="font-display text-xl font-bold">{totalDeals}</p>
              <p className="text-[0.66rem] uppercase tracking-[0.14em] text-white/80">Sample deals</p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED DEALS */}
      <section className="mx-auto max-w-6xl px-4 py-14" id="deals">
        <div className="text-center">
          <p className="kicker">Featured deals</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            This week around the lake
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-ink-soft">
            Every deal below is from a clearly labelled sample vendor while the marketplace is in
            preview — no real Lake County business has agreed to these offers yet.
          </p>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((deal) => (
            <DealCard key={deal.id} deal={deal} />
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            to="/deals"
            className="inline-flex items-center gap-2 rounded-full border border-brand/40 px-5 py-2.5 text-sm font-semibold text-brand-dark transition hover:border-brand hover:bg-white"
          >
            View all {totalDeals} deals
            <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="border-y border-black/5 bg-white/60" id="categories">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="text-center">
            <p className="kicker">Browse by category</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
              Everything Lake County has to offer
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-ink-soft">
              From family-owned restaurants to skilled home services — pick a category to see the
              businesses near you.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {DIRECTORY_CATEGORIES.map((c) => (
              <Link
                key={c.slug}
                to="/businesses"
                search={{ category: c.slug }}
                className="group rounded-2xl border border-black/5 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-green/12 text-brand-green-dark">
                  <CategoryIcon slug={c.slug} className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm leading-snug font-semibold text-ink group-hover:text-brand-dark">
                  {c.name}
                </p>
                <p className="mt-1 text-[0.72rem] text-ink-soft">Browse businesses</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="text-center">
          <p className="kicker">How it works</p>
          <h2 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            Buy a voucher in under a minute
          </h2>
        </div>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              n: "1",
              t: "Pick a city",
              d: "Choose your community, or browse all 17 Lake County cities.",
              icon: "pin",
            },
            {
              n: "2",
              t: "Find a deal",
              d: "Each deal shows the price, the value, the savings and how many vouchers are left.",
              icon: "ticket",
            },
            {
              n: "3",
              t: "Get your code",
              d: "You get a voucher code instantly and a printable page to keep.",
              icon: "check",
            },
            {
              n: "4",
              t: "Show up local",
              d: "Present the code at the business and enjoy — the vendor keeps 100% of what you paid.",
              icon: "home",
            },
          ].map((s) => (
            <li key={s.n} className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  {s.n}
                </span>
                <Icon name={s.icon} className="h-4 w-4 text-brand-green-dark" />
              </div>
              <h3 className="mt-3 font-display text-lg font-semibold text-ink">{s.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{s.d}</p>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-6 max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-[0.8rem] text-amber-900">
          Heads up: this is a preview. Checkout is a demo — you get a real voucher code in the
          marketplace, but no payment is taken and no card is charged.
        </p>
      </section>

      {/* CITIES */}
      <section className="border-y border-black/5 bg-white/60" id="cities">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="text-center">
            <p className="kicker">Browse by location</p>
            <h2 className="mt-2 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
              Find deals near you
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-ink-soft">
              Explore city-level collections across Lake County.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CITIES.map((c) => (
              <Link
                key={c.slug}
                to="/city/$slug"
                params={{ slug: c.slug }}
                className="group flex items-center justify-between gap-2 rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm transition hover:border-brand/30 hover:shadow-md"
              >
                <span>
                  <span className="block text-sm font-semibold text-ink group-hover:text-brand-dark">
                    {c.name}
                  </span>
                  <span className="text-[0.7rem] text-ink-soft">Browse businesses</span>
                </span>
                <Icon name="arrow" className="h-4 w-4 text-brand/60" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* VENDOR CTA */}
      <section className="mx-auto max-w-6xl px-4 pt-14" id="for-vendors">
        <div className="overflow-hidden rounded-3xl bg-brand-dark px-6 py-10 text-white sm:px-10">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-green">
            For your community
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight font-semibold sm:text-4xl">
            Sell your own vouchers — keep 100% of the revenue, flat monthly fee.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/85">
            Shop My Neighborhood never takes a percentage of your voucher sales. Publish your own
            deals, set your own voucher limits, and get discovered by shoppers already searching
            nearby categories. Vendor accounts are not live yet — tell us you&apos;re interested and
            we&apos;ll set you up as soon as they open.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href={`mailto:${SITE.email}?subject=${encodeURIComponent("Vendor interest — Shop My Neighborhood Lake County")}`}
              className="rounded-full bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-green-dark"
            >
              Email us about a vendor account
            </a>
            <a
              href={SITE.phoneHref}
              className="rounded-full border border-white/30 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white"
            >
              Call {SITE.phone}
            </a>
          </div>
          <div className="mt-8 grid gap-3 text-sm text-white/85 sm:grid-cols-3">
            {[
              "No commission on voucher revenue — ever.",
              "Flat monthly subscription sets your deal and voucher limits.",
              "A free directory listing underneath, so shoppers find you either way.",
            ].map((line) => (
              <p key={line} className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
                {line}
              </p>
            ))}
          </div>
        </div>
      </section>
    </MarketplaceShell>
  );
}
