import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { DirectoryHero, OSMAttribution } from "~/components/directory";
import { CategoryIcon } from "~/components/icons";
import { MarketplaceShell } from "~/components/site-chrome";
import { CITIES, DIRECTORY_CATEGORIES } from "~/lib/taxonomy";
import { fetchDirectoryCity } from "~/server/directory-functions";

export const Route = createFileRoute("/city/$slug")({
  loader: async ({ params }) => { const city = CITIES.find((item) => item.slug === params.slug); if (!city) throw notFound(); return { city, ...(await fetchDirectoryCity({ data: { city: city.slug } })) }; },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.city.name}, FL Businesses | Local Directory` : "City not found" }, { name: "description", content: loaderData ? `Browse local businesses in ${loaderData.city.name}, Florida by category.` : "" }] }),
  component: CityPage,
});

function CityPage() {
  const { city, counts, total } = Route.useLoaderData();
  const countMap = new Map(counts.map((row) => [row.slug, row.count]));
  return (
    <MarketplaceShell city={city.slug}>
      <DirectoryHero kicker="Free local directory" title={`${city.name}, Florida businesses`}>
        <p className="mt-3 text-sm text-ink-soft">{total.toLocaleString("en-US")} {total === 1 ? "business" : "businesses"} listed in {city.name}. Pick a category.</p>
        <Link to="/businesses" search={{ city: city.slug }} className="mt-4 inline-block rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">All {city.name} businesses</Link>
      </DirectoryHero>
      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DIRECTORY_CATEGORIES.map((category) => {
            const count = countMap.get(category.slug) ?? 0;
            return (
              <Link key={category.slug} to="/businesses" search={{ city: city.slug, category: category.slug }} className="group rounded-2xl border border-black/5 bg-white p-5 shadow-sm hover:border-brand/30 hover:shadow-md">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-green/12 text-brand-green-dark"><CategoryIcon slug={category.slug} className="h-5 w-5" /></span>
                <h2 className="mt-3 font-display text-xl font-semibold text-brand-dark group-hover:underline">{category.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">{count} {count === 1 ? "business" : "businesses"} in {city.name}</p>
              </Link>
            );
          })}
        </div>
        <OSMAttribution />
      </section>
    </MarketplaceShell>
  );
}
