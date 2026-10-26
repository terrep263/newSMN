import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { BusinessCard, DirectoryHero, OSMAttribution } from "~/components/directory";
import { MarketplaceShell } from "~/components/site-chrome";
import { CITIES, directoryCategoryFromSlug } from "~/lib/taxonomy";
import { fetchDirectoryBusinesses } from "~/server/directory-functions";

export const Route = createFileRoute("/categories/$slug")({
  validateSearch: (search: Record<string, unknown>) => ({ city: typeof search.city === "string" ? search.city : undefined }),
  loader: async ({ params, search }) => { const category = directoryCategoryFromSlug(params.slug); if (!category) throw notFound(); const requestedCity = search?.city; const city = requestedCity && CITIES.some((item) => item.slug === requestedCity) ? requestedCity : undefined; return { category, city, ...(await fetchDirectoryBusinesses({ data: { category: category.slug, city } })) }; }, 
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.category.name} in Lake County, FL | Directory` : "Category not found" }, { name: "description", content: loaderData ? `Browse ${loaderData.category.name.toLowerCase()} businesses in Lake County, Florida.` : "" }] }),
  component: CategoryPage,
});
function CategoryPage() {
  const { category, city, businesses, total } = Route.useLoaderData(); const cityName = CITIES.find((item) => item.slug === city)?.name;
  return <MarketplaceShell city={city}><DirectoryHero kicker="Free local directory" title={`${category.name} in ${cityName ?? "Lake County, FL"}`}><p className="mt-3 text-sm text-ink-soft">{total} {total === 1 ? "business" : "businesses"} listed{cityName ? ` in ${cityName}` : " across Lake County"}. Explore local options, then contact businesses directly.</p></DirectoryHero><section className="mx-auto max-w-6xl px-4 py-8"><div className="flex flex-wrap gap-2"><Link to="/categories/$slug" params={{ slug: category.slug }} search={{ city: undefined }} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${!city ? "bg-brand text-white" : "bg-white text-brand-dark ring-1 ring-black/10"}`}>All cities</Link>{CITIES.map((item) => <Link key={item.slug} to="/categories/$slug" params={{ slug: category.slug }} search={{ city: item.slug }} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${city === item.slug ? "bg-brand text-white" : "bg-white text-brand-dark ring-1 ring-black/10"}`}>{item.name}</Link>)}</div>{businesses.length ? <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{businesses.map((business) => <BusinessCard key={business.id} business={business} />)}</div> : <div className="mt-6 rounded-2xl border border-dashed border-brand/30 bg-white p-8 text-center text-sm text-ink-soft">No {category.name.toLowerCase()} listings have been imported for this city yet. Try all Lake County cities.</div>}<OSMAttribution /></section></MarketplaceShell>;
}