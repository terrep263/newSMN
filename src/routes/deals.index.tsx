import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { DealCard } from "~/components/deal-card";
import { Icon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { CATEGORIES, CITIES, cityNameFromSlug, categoryFromSlug } from "~/lib/taxonomy";
import { fetchDeals } from "~/server/functions";

type DealsSort = "ending-soon" | "biggest-savings" | "default";

type DealsSearch = {
  city?: string;
  category?: string;
  sort?: DealsSort;
  q?: string;
};

const SORTS: { value: DealsSort; label: string }[] = [
  { value: "default", label: "Most popular" },
  { value: "ending-soon", label: "Ending soon" },
  { value: "biggest-savings", label: "Biggest savings" },
];

export const Route = createFileRoute("/deals/")({
  validateSearch: (search: Record<string, unknown>): DealsSearch => {
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
    const city = str(search.city);
    const category = str(search.category);
    const q = str(search.q);
    const rawSort = str(search.sort);
    const sort: DealsSort | undefined =
      rawSort === "ending-soon" || rawSort === "biggest-savings" || rawSort === "default"
        ? rawSort
        : undefined;
    return {
      // Unknown slugs are passed through so the page can render an honest
      // "no deals" state instead of silently showing everything.
      city,
      category,
      q,
      sort,
    };
  },
  loaderDeps: ({ search }) => ({
    city: search.city,
    category: search.category,
    q: search.q,
    sort: search.sort,
  }),
  loader: ({ deps }) =>
    fetchDeals({
      data: {
        // URLs carry the city slug; the database stores the display name.
        city: deps.city ? (cityNameFromSlug(deps.city) ?? deps.city) : undefined,
        category: deps.category,
        q: deps.q,
        sort: deps.sort === "default" ? undefined : deps.sort,
      },
    }),
  head: ({ match }) => {
    const search = match.search as DealsSearch;
    const cityName = cityNameFromSlug(search.city ?? undefined);
    const cat = categoryFromSlug(search.category ?? undefined);
    const title = [cat?.name ?? "Local Deals", cityName ? `in ${cityName}` : "in Lake County"]
      .join(" ")
      .concat(" | Shop My Neighborhood");
    return {
      meta: [
        { title },
        {
          name: "description",
          content: `Browse ${cat ? cat.name.toLowerCase() + " " : ""}deal vouchers ${
            cityName ? `in ${cityName}, Lake County, FL` : "across Lake County, FL"
          }. Filter by city and category, sorted by ending soon or biggest savings.`,
        },
      ],
    };
  },
  component: DealsPage,
});

function DealsPage() {
  const deals = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const cityName = cityNameFromSlug(search.city);
  const category = categoryFromSlug(search.category);
  const activeSort: DealsSort = search.sort ?? "default";
  const hasFilters = Boolean(search.city || search.category || search.q);

  const heading = [category?.name ?? "All deals", cityName ? `in ${cityName}` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <MarketplaceShell city={search.city}>
      <section className="border-b border-black/5 bg-white/60">
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-6">
          <nav className="text-[0.72rem] text-ink-soft">
            <Link to="/" className="hover:text-brand">
              Home
            </Link>
            <span className="mx-1.5">/</span>
            <Link to="/deals" className="hover:text-brand">
              Deals
            </Link>
            {(cityName || category) && <span className="mx-1.5">/</span>}
            {cityName && <span className="text-ink">{cityName}</span>}
            {cityName && category && <span className="mx-1.5">/</span>}
            {category && <span className="text-ink">{category.name}</span>}
          </nav>

          <h1 className="mt-3 font-display text-3xl font-semibold text-brand-dark sm:text-4xl">
            {heading}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            {deals.length === 1 ? "1 deal" : `${deals.length} ${deals.length === 0 ? "" : "deals"}`} available now ·
            all sample data while the marketplace is in preview
          </p>

          {/* Filters — a plain GET form, so each result set has a shareable URL */}
          <form action="/deals" method="get" className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="relative block">
              <span className="sr-only">City</span>
              <Icon name="pin" className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-brand" />
              <select
                name="city"
                defaultValue={search.city ?? ""}
                className="w-full appearance-none rounded-xl border border-black/10 bg-white py-2.5 pr-8 pl-9 text-sm font-medium shadow-sm focus:ring-2 focus:ring-brand/30 focus:outline-none"
              >
                <option value="">All cities</option>
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
                defaultValue={search.category ?? ""}
                className="w-full appearance-none rounded-xl border border-black/10 bg-white py-2.5 pr-8 pl-9 text-sm font-medium shadow-sm focus:ring-2 focus:ring-brand/30 focus:outline-none"
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

            <label className="relative block">
              <span className="sr-only">Sort by</span>
              <Icon name="clock" className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-brand" />
              <select
                name="sort"
                defaultValue={activeSort}
                className="w-full appearance-none rounded-xl border border-black/10 bg-white py-2.5 pr-8 pl-9 text-sm font-medium shadow-sm focus:ring-2 focus:ring-brand/30 focus:outline-none"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute top-2.5 right-3 text-xs text-ink-soft">▾</span>
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
              >
                Apply filters
              </button>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => navigate({ to: "/deals", search: { sort: search.sort } })}
                  className="rounded-xl border border-black/10 px-3 py-2.5 text-sm font-medium text-ink-soft hover:border-brand/40 hover:text-brand"
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Quick sort chips (also shareable links) */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.75rem]">
            <span className="text-ink-soft">Sort:</span>
            {SORTS.map((s) => (
              <Link
                key={s.value}
                to="/deals"
                search={{ ...search, sort: s.value === "default" ? undefined : s.value }}
                className={`rounded-full border px-3 py-1 font-medium ${
                  activeSort === s.value
                    ? "border-brand bg-brand/10 text-brand-dark"
                    : "border-black/10 bg-white text-ink-soft hover:border-brand/40 hover:text-brand"
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8">
        {deals.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-3xl border border-black/5 bg-white px-6 py-12 text-center shadow-sm">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-cream-deep text-brand">
              <Icon name="search" className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-2xl font-semibold text-brand-dark">
              No deals match those filters
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              {cityName
                ? `There aren't any ${category ? category.name.toLowerCase() + " " : ""}deals in ${cityName} yet. `
                : "Nothing matches that combination yet. "}
              New sample deals are added as the marketplace fills out — try a nearby city or another
              category.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link
                to="/deals"
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Show all deals
              </Link>
              {search.city && (
                <Link
                  to="/deals"
                  search={{ ...search, city: undefined }}
                  className="rounded-full border border-brand/30 px-4 py-2 text-sm font-semibold text-brand-dark hover:border-brand"
                >
                  Drop the city filter
                </Link>
              )}
              {search.category && (
                <Link
                  to="/deals"
                  search={{ ...search, category: undefined }}
                  className="rounded-full border border-brand/30 px-4 py-2 text-sm font-semibold text-brand-dark hover:border-brand"
                >
                  Drop the category filter
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {deals.map((deal) => (
              <DealCard key={deal.id} deal={deal} />
            ))}
          </div>
        )}
      </section>
    </MarketplaceShell>
  );
}
