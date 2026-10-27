import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { CITIES, directoryCategoryFromSlug } from "~/lib/taxonomy";

// Category links (old bookmarks, search engines) land on the one directory search.
export const Route = createFileRoute("/categories/$slug")({
  validateSearch: (search: Record<string, unknown>): { city?: string } => ({ city: typeof search.city === "string" ? search.city : undefined }),
  beforeLoad: ({ params, search }) => {
    const category = directoryCategoryFromSlug(params.slug);
    if (!category) throw notFound();
    const city = search.city && CITIES.some((c) => c.slug === search.city) ? search.city : undefined;
    throw redirect({ to: "/businesses", search: { category: category.slug, city }, statusCode: 301 });
  },
});
