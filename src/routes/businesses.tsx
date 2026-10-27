import { Link, createFileRoute } from "@tanstack/react-router";
import { BusinessCard, DirectoryHero, OSMAttribution } from "~/components/directory";
import { MarketplaceShell } from "~/components/site-chrome";
import { CITIES, DIRECTORY_CATEGORIES, canonicalCategorySlug } from "~/lib/taxonomy";
import { fetchDirectoryBusinesses } from "~/server/directory-functions";

type Search = { q?: string; city?: string; category?: string; sort?: "name" | "reviews"; page?: number };

const SORTS = [
  { value: "", label: "Top rated" },
  { value: "reviews", label: "Most reviewed" },
  { value: "name", label: "Name A–Z" },
] as const;

export const Route = createFileRoute("/businesses")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const city = typeof search.city === "string" && CITIES.some((c) => c.slug === search.city) ? search.city : undefined;
    const rawCategory = typeof search.category === "string" ? canonicalCategorySlug(search.category) : "";
    const category = DIRECTORY_CATEGORIES.some((c) => c.slug === rawCategory) ? rawCategory : undefined;
    const q = typeof search.q === "string" && search.q.trim() ? search.q.trim().slice(0, 80) : undefined;
    const sort = search.sort === "name" || search.sort === "reviews" ? search.sort : undefined;
    const page = Number(search.page) >= 2 ? Math.floor(Number(search.page)) : undefined;
    return { q, city, category, sort, page };
  },
  loaderDeps: ({ search }) => ({ q: search.q, city: search.city, category: search.category, sort: search.sort, page: search.page }),
  loader: ({ deps }) => fetchDirectoryBusinesses({ data: deps }),
  head: ({ match }) => {
    const { city, category } = match.search;
    const cityName = CITIES.find((c) => c.slug === city)?.name;
    const categoryName = DIRECTORY_CATEGORIES.find((c) => c.slug === category)?.name;
    const title = categoryName && cityName ? `${categoryName} in ${cityName}, FL` : categoryName ? `${categoryName} in Lake County, FL` : cityName ? `Businesses in ${cityName}, FL` : "Search Lake County Businesses";
    return { meta: [{ title: `${title} | Local Directory` }, { name: "description", content: `Find ${categoryName?.toLowerCase() ?? "local businesses"} in ${cityName ?? "Lake County"}, Florida by city and category.` }] };
  },
  component: BusinessesPage,
});

const chip = (active: boolean) => `rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-brand text-white" : "bg-white text-brand-dark ring-1 ring-black/10 hover:ring-brand/40"}`;

function BusinessesPage() {
  const search = Route.useSearch();
  const { businesses, total, page, pages, pageSize, categoryFacets, cityFacets } = Route.useLoaderData();
  const catCount = new Map(categoryFacets.map((r) => [r.slug, r.count]));
  const cityCount = new Map(cityFacets.map((r) => [r.slug, r.count]));
  const cityName = CITIES.find((c) => c.slug === search.city)?.name;
  const category = DIRECTORY_CATEGORIES.find((c) => c.slug === search.category);
  const heading = category && cityName ? `${category.name} in ${cityName}` : category ? `${category.name} in Lake County` : cityName ? `Businesses in ${cityName}` : "Search Lake County businesses";
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);

  return (
    <MarketplaceShell city={search.city}>
      <DirectoryHero kicker="Free local directory" title={heading}>
        <p className="mt-3 text-sm text-ink-soft">Pick a city and a category, or search by business name.</p>
      </DirectoryHero>
      <section className="mx-auto max-w-6xl px-4 py-8">
        <form method="get" className="grid gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_1.5fr_auto]">
          <label><span className="sr-only">City</span>
            <select name="city" defaultValue={search.city ?? ""} className="w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm">
              <option value="">All cities</option>
              {CITIES.map((c) => <option value={c.slug} key={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label><span className="sr-only">Category</span>
            <select name="category" defaultValue={search.category ?? ""} className="w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm">
              <option value="">All categories</option>
              {DIRECTORY_CATEGORIES.map((c) => <option value={c.slug} key={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label><span className="sr-only">Business name</span>
            <input name="q" defaultValue={search.q ?? ""} placeholder="Business name (optional)" className="w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm" />
          </label>
          {search.sort && <input type="hidden" name="sort" value={search.sort} />}
          <button className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">Search</button>
        </form>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft">City</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to="/businesses" search={{ ...search, city: undefined, page: undefined }} className={chip(!search.city)}>All cities</Link>
            {CITIES.filter((c) => (cityCount.get(c.slug) ?? 0) > 0 || c.slug === search.city).map((c) => (
              <Link key={c.slug} to="/businesses" search={{ ...search, city: c.slug, page: undefined }} className={chip(search.city === c.slug)}>{c.name} <span className="opacity-70">{cityCount.get(c.slug) ?? 0}</span></Link>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft">Category</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to="/businesses" search={{ ...search, category: undefined, page: undefined }} className={chip(!search.category)}>All categories</Link>
            {DIRECTORY_CATEGORIES.filter((c) => (catCount.get(c.slug) ?? 0) > 0 || c.slug === search.category).map((c) => (
              <Link key={c.slug} to="/businesses" search={{ ...search, category: c.slug, page: undefined }} className={chip(search.category === c.slug)}>{c.short} <span className="opacity-70">{catCount.get(c.slug) ?? 0}</span></Link>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft">
            {total ? `Showing ${from}–${to} of ${total.toLocaleString("en-US")} ${total === 1 ? "business" : "businesses"}` : "0 businesses found"}
            {cityName ? ` in ${cityName}` : ""}{search.q ? ` matching “${search.q}”` : ""}.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-[0.14em] text-ink-soft">Sort</span>
            {SORTS.map((s) => (
              <Link key={s.label} to="/businesses" search={{ ...search, sort: s.value ? s.value : undefined, page: undefined }} className={chip((search.sort ?? "") === s.value)}>{s.label}</Link>
            ))}
          </div>
        </div>

        {businesses.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {businesses.map((business) => <BusinessCard key={business.id} business={business} />)}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-brand/30 bg-white p-10 text-center">
            <h2 className="font-display text-xl text-brand-dark">No matches</h2>
            <p className="mt-2 text-sm text-ink-soft">Try another spelling or choose “All cities” or “All categories”.</p>
            <Link to="/businesses" search={{}} className="mt-4 inline-block rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">Clear filters</Link>
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {page > 1 && <Link to="/businesses" search={{ ...search, page: page - 1 > 1 ? page - 1 : undefined }} className={chip(false)}>← Previous</Link>}
            {pageNumbers.map((n, i) => (
              <span key={n} className="flex items-center gap-2">
                {i > 0 && n - pageNumbers[i - 1] > 1 && <span className="text-ink-soft">…</span>}
                <Link to="/businesses" search={{ ...search, page: n > 1 ? n : undefined }} className={chip(n === page)}>{n}</Link>
              </span>
            ))}
            {page < pages && <Link to="/businesses" search={{ ...search, page: page + 1 }} className={chip(false)}>Next →</Link>}
          </nav>
        )}
        <OSMAttribution />
      </section>
    </MarketplaceShell>
  );
}
