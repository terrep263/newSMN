import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { BusinessCard, DirectoryHero, OSMAttribution } from "~/components/directory";
import { MarketplaceShell } from "~/components/site-chrome";
import { CITIES, DIRECTORY_CATEGORIES } from "~/lib/taxonomy";
import { fetchDirectoryCity } from "~/server/directory-functions";

export const Route = createFileRoute("/city/$slug")({
  loader: async ({ params }) => { const city = CITIES.find((item) => item.slug === params.slug); if (!city) throw notFound(); return { city, ...(await fetchDirectoryCity({ data: { city: city.slug } })) }; },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.city.name}, FL Businesses | Local Directory` : "City not found" }, { name: "description", content: loaderData ? `Browse local businesses in ${loaderData.city.name}, Florida by category.` : "" }] }),
  component: CityPage,
});
function CityPage() {
  const { city, businesses, counts, total } = Route.useLoaderData(); const countMap = new Map(counts.map((row) => [row.slug, row.count]));
  return <MarketplaceShell city={city.slug}><DirectoryHero kicker="Free local directory" title={`${city.name}, Florida businesses`}><p className="mt-3 text-sm text-ink-soft">{total} {total === 1 ? "business" : "businesses"} currently listed in {city.name}, organized by category.</p></DirectoryHero><section className="mx-auto max-w-6xl px-4 py-10">{DIRECTORY_CATEGORIES.map((category) => { const categoryBusinesses = businesses.filter((business) => business.category_slug === category.slug); const count = countMap.get(category.slug) ?? 0; return <section key={category.slug} className="mb-10"><div className="flex flex-wrap items-baseline justify-between gap-3"><div><h2 className="font-display text-2xl font-semibold text-brand-dark">{category.name}</h2><p className="mt-1 text-sm text-ink-soft">{count} {count === 1 ? "business" : "businesses"}</p></div><Link to="/categories/$slug" params={{ slug: category.slug }} search={{ city: city.slug }} className="text-sm font-semibold text-brand hover:underline">View {city.name} listings →</Link></div>{categoryBusinesses.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{categoryBusinesses.map((business) => <BusinessCard key={business.id} business={business} />)}</div> : <p className="mt-3 text-sm text-ink-soft">No imported listings in this category yet.</p>}</section>; })}<OSMAttribution /></section></MarketplaceShell>;
}