import { Link, createFileRoute } from "@tanstack/react-router";
import { CategoryIcon } from "~/components/icons";
import { DirectoryHero, OSMAttribution } from "~/components/directory";
import { MarketplaceShell } from "~/components/site-chrome";
import { DIRECTORY_CATEGORIES } from "~/lib/taxonomy";
import { fetchDirectoryCategoryCounts } from "~/server/directory-functions";

export const Route = createFileRoute("/categories")({
  loader: () => fetchDirectoryCategoryCounts(),
  head: () => ({ meta: [{ title: "Browse Local Business Categories | Lake County, FL" }, { name: "description", content: "Browse real Lake County, Florida businesses by category in the free Shop My Neighborhood directory." }] }),
  component: CategoriesPage,
});
function CategoriesPage() {
  const rows = Route.useLoaderData(); const counts = new Map(rows.map((row) => [row.slug, row.count]));
  return <MarketplaceShell><DirectoryHero kicker="Free local directory" title="Browse Lake County businesses by category"><p className="mt-3 max-w-2xl text-sm text-ink-soft">Find local businesses across all 17 Lake County communities. Listings are sourced from OpenStreetMap.</p></DirectoryHero><section className="mx-auto max-w-6xl px-4 py-10"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{DIRECTORY_CATEGORIES.map((category) => <Link key={category.slug} to="/categories/$slug" params={{ slug: category.slug }} className="group rounded-2xl border border-black/5 bg-white p-5 shadow-sm hover:border-brand/30 hover:shadow-md"><span className="grid h-10 w-10 place-items-center rounded-full bg-brand-green/12 text-brand-green-dark"><CategoryIcon slug={category.slug} className="h-5 w-5" /></span><h2 className="mt-3 font-display text-xl font-semibold text-brand-dark group-hover:underline">{category.name}</h2><p className="mt-1 text-sm text-ink-soft">{counts.get(category.slug) ?? 0} {(counts.get(category.slug) ?? 0) === 1 ? "business" : "businesses"}</p></Link>)}</div><OSMAttribution /></section></MarketplaceShell>;
}